import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { CalendarUserLockEntity } from '../entity/calendar_user_lock.entity';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { DailyReconciliationStatus } from '../types/calendar.enum';

@Injectable()
export class CalendarCronService {
  private readonly logger = new Logger(CalendarCronService.name);

  constructor(
    @InjectRepository(WorkShiftEntity)
    private readonly shiftRepository: Repository<WorkShiftEntity>,
    @InjectRepository(DailyReconciliationEntity)
    private readonly reconciliationRepository: Repository<DailyReconciliationEntity>,
    @InjectRepository(CalendarUserLockEntity)
    private readonly lockRepository: Repository<CalendarUserLockEntity>,
    private readonly policyService: WorkspaceCalendarPolicyService,
  ) {}

  /**
   * Runs every day at 23:50 Asia/Ho_Chi_Minh.
   * Reconciles registered work shifts with actual attendance logs:
   *   - No check-in → ABSENT
   *   - Checked in but never checked out → auto-close at shift.endTime, compute hours
   *   - Existing records → fill lateMinutes / earlyLeaveMinutes / standardWorkHours
   */
  @Cron('50 23 * * *', {
    name: 'daily-attendance-reconciliation',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async dailyReconciliation() {
    const workDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    this.logger.log(`[DailyReconciliation] Starting for ${workDate}`);

    const shifts = await this.shiftRepository.find({ where: { workDate } });

    if (!shifts.length) {
      this.logger.log(`[DailyReconciliation] No shifts found for ${workDate}, skipping.`);
      return;
    }

    const graceMap = await this.buildGraceMap(shifts);
    const now = new Date();
    const counts = { absent: 0, closed: 0, updated: 0 };
    const shiftGroups = this.groupShiftsByUser(shifts);

    for (const [groupKey, group] of shiftGroups) {
      try {
        const graceMinutes = graceMap.get(group[0].workspaceId) ?? 15;
        await this.reconcileDay(group, now, counts, graceMinutes);
      } catch (err) {
        this.logger.error(
          `[DailyReconciliation] Failed for ${groupKey} on ${workDate}: ${err?.message}`,
        );
      }
    }

    this.logger.log(
      `[DailyReconciliation] Done for ${workDate} — ` +
        `groups: ${shiftGroups.size}, absent: ${counts.absent}, auto-closed: ${counts.closed}, updated: ${counts.updated}`,
    );
  }

  private async buildGraceMap(shifts: WorkShiftEntity[]): Promise<Map<string, number>> {
    const workspaceIds = [...new Set(shifts.map(s => s.workspaceId))];
    const map = new Map<string, number>();
    for (const wsId of workspaceIds) {
      const policy = await this.policyService.getPolicy(wsId);
      const policyData = policy?.policyData as Record<string, any> | undefined;
      map.set(wsId, policyData?.gracePeriodMinutes ?? 15);
    }
    return map;
  }

  // Groups shifts by (workspaceId, userId) and sorts each group by startTime ascending.
  // Key format: "workspaceId:userId" — ensures users in multiple workspaces are never mixed.
  // A user can have multiple non-overlapping shifts on the same day; they must
  // be reconciled together so only one DailyReconciliationEntity is written per workspace.
  private groupShiftsByUser(shifts: WorkShiftEntity[]): Map<string, WorkShiftEntity[]> {
    const groups = new Map<string, WorkShiftEntity[]>();
    for (const shift of shifts) {
      const key = `${shift.workspaceId}:${shift.userId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(shift);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return groups;
  }

  // Reconciles all shifts for one user on one day into a single DailyReconciliationEntity.
  // shifts must be sorted by startTime ascending (guaranteed by groupShiftsByUser).
  private async reconcileDay(
    shifts: WorkShiftEntity[],
    now: Date,
    counts: { absent: number; closed: number; updated: number },
    graceMinutes: number,
  ) {
    const primaryShift = shifts[0];
    const lastShift = shifts[shifts.length - 1];
    const { workspaceId, userId, workDate } = primaryShift;
    const shiftStart = new Date(primaryShift.startTime);
    const shiftEnd = new Date(lastShift.endTime);
    const standardWorkHours = Math.round(
      shifts.reduce((sum, s) => sum + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000, 0) * 100,
    ) / 100;

    let record = await this.reconciliationRepository.findOne({
      where: { workspaceId, userId, workDate },
    });

    // No attendance at all → ABSENT
    if (!record) {
      await this.reconciliationRepository.save(
        this.reconciliationRepository.create({
          workspaceId,
          userId,
          workDate,
          workShiftId: primaryShift.id,
          standardWorkHours,
          status: DailyReconciliationStatus.ABSENT,
        }),
      );
      counts.absent++;
      return;
    }

    // Leave-approved records are managed by CalendarRequestService — skip
    if (
      record.status === DailyReconciliationStatus.LEAVE_PAID_APPROVED ||
      record.status === DailyReconciliationStatus.LEAVE_UNPAID_APPROVED
    ) {
      return;
    }

    // Checked in but never checked out → auto-close at last shift's endTime
    if (record.firstCheckIn && !record.lastCheckOut) {
      const effectiveOut = shiftEnd < now ? shiftEnd : now;
      record.lastCheckOut = effectiveOut;
      counts.closed++;
    }

    // Fill metadata: link to primary (earliest) shift, sum standard hours across all shifts
    record.workShiftId = primaryShift.id;
    record.standardWorkHours = standardWorkHours;

    if (record.firstCheckIn) {
      const lateMsRaw = record.firstCheckIn.getTime() - shiftStart.getTime();
      record.lateMinutes = Math.max(0, Math.floor(lateMsRaw / 60_000));
    }

    if (record.lastCheckOut) {
      const earlyMsRaw = shiftEnd.getTime() - record.lastCheckOut.getTime();
      record.earlyLeaveMinutes = Math.max(0, Math.floor(earlyMsRaw / 60_000));
    }

    if (record.firstCheckIn && record.lastCheckOut) {
      const diffMs = record.lastCheckOut.getTime() - record.firstCheckIn.getTime();
      record.actualWorkHours = Math.round((diffMs / 3_600_000) * 100) / 100;
    }

    // Final status: LATE_EARLY if either metric exceeds grace, else NORMAL
    if (!record.firstCheckIn) {
      record.status = DailyReconciliationStatus.ABSENT;
    } else if (record.lateMinutes > graceMinutes || record.earlyLeaveMinutes > graceMinutes) {
      record.status = DailyReconciliationStatus.LATE_EARLY;
    } else {
      record.status = DailyReconciliationStatus.NORMAL;
    }

    await this.reconciliationRepository.save(record);
    counts.updated++;
  }

  /**
   * Runs every Sunday at 02:00 Asia/Ho_Chi_Minh.
   * Deletes CalendarUserLockEntity records whose unlock window has expired.
   * Expired records are safe to remove — checkLockDeadline already ignores them
   * (it checks `isUnlocked && unlockExpiresAt > now`), but they accumulate indefinitely.
   */
  @Cron('0 2 * * 0', {
    name: 'cleanup-expired-locks',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async cleanupExpiredLocks() {
    const now = new Date();
    const result = await this.lockRepository.delete({ unlockExpiresAt: LessThan(now) });
    this.logger.log(`[CleanupExpiredLocks] Deleted ${result.affected ?? 0} expired lock records`);
  }

  async runManually(workDate?: string) {
    const targetDate = workDate ?? new Date().toISOString().slice(0, 10);
    this.logger.log(`[DailyReconciliation] Manual run for ${targetDate}`);

    const shifts = await this.shiftRepository.find({ where: { workDate: targetDate } });
    const graceMap = await this.buildGraceMap(shifts);
    const now = new Date();
    const counts = { absent: 0, closed: 0, updated: 0 };
    const shiftGroups = this.groupShiftsByUser(shifts);

    for (const [groupKey, group] of shiftGroups) {
      try {
        const graceMinutes = graceMap.get(group[0].workspaceId) ?? 15;
        await this.reconcileDay(group, now, counts, graceMinutes);
      } catch (err) {
        this.logger.error(`[DailyReconciliation] Manual run error for ${groupKey}: ${err?.message}`);
      }
    }

    return {
      workDate: targetDate,
      totalShifts: shiftGroups.size,
      ...counts,
    };
  }
}