import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { DailyReconciliationStatus } from '../types/calendar.enum';

const GRACE_MINUTES = 15;

@Injectable()
export class CalendarCronService {
  private readonly logger = new Logger(CalendarCronService.name);

  constructor(
    @InjectRepository(WorkShiftEntity)
    private readonly shiftRepository: Repository<WorkShiftEntity>,
    @InjectRepository(DailyReconciliationEntity)
    private readonly reconciliationRepository: Repository<DailyReconciliationEntity>,
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
    const workDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC date — acceptable since cron fires at 23:50 local)
    this.logger.log(`[DailyReconciliation] Starting for ${workDate}`);

    const shifts = await this.shiftRepository.find({ where: { workDate } });

    if (!shifts.length) {
      this.logger.log(`[DailyReconciliation] No shifts found for ${workDate}, skipping.`);
      return;
    }

    const now = new Date();
    const counts = { absent: 0, closed: 0, updated: 0 };

    for (const shift of shifts) {
      try {
        await this.reconcileShift(shift, now, counts);
      } catch (err) {
        this.logger.error(
          `[DailyReconciliation] Failed for shift ${shift.id} (user ${shift.userId}): ${err?.message}`,
        );
      }
    }

    this.logger.log(
      `[DailyReconciliation] Done for ${workDate} — ` +
        `total: ${shifts.length}, absent: ${counts.absent}, auto-closed: ${counts.closed}, updated: ${counts.updated}`,
    );
  }

  private async reconcileShift(
    shift: WorkShiftEntity,
    now: Date,
    counts: { absent: number; closed: number; updated: number },
  ) {
    const { workspaceId, userId, workDate } = shift;
    const shiftStart = new Date(shift.startTime);
    const shiftEnd = new Date(shift.endTime);
    const standardWorkHours =
      Math.round(((shiftEnd.getTime() - shiftStart.getTime()) / 3_600_000) * 100) / 100;

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
          workShiftId: shift.id,
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

    // Checked in but never checked out → auto-close at shift.endTime (or now if shift hasn't ended yet)
    if (record.firstCheckIn && !record.lastCheckOut) {
      const effectiveOut = shiftEnd < now ? shiftEnd : now;
      record.lastCheckOut = effectiveOut;
      counts.closed++;
    }

    // Fill metadata fields
    record.workShiftId = shift.id;
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
    } else if (record.lateMinutes > GRACE_MINUTES || record.earlyLeaveMinutes > GRACE_MINUTES) {
      record.status = DailyReconciliationStatus.LATE_EARLY;
    } else {
      record.status = DailyReconciliationStatus.NORMAL;
    }

    await this.reconciliationRepository.save(record);
    counts.updated++;
  }

  /**
   * Manual trigger for testing — call via a dedicated endpoint or NestJS REPL.
   * Accepts an optional date override (YYYY-MM-DD) so QA can simulate any day.
   */
  async runManually(workDate?: string) {
    const targetDate = workDate ?? new Date().toISOString().slice(0, 10);
    this.logger.log(`[DailyReconciliation] Manual run for ${targetDate}`);

    const shifts = await this.shiftRepository.find({ where: { workDate: targetDate } });
    const now = new Date();
    const counts = { absent: 0, closed: 0, updated: 0 };

    for (const shift of shifts) {
      try {
        await this.reconcileShift({ ...shift, workDate: targetDate }, now, counts);
      } catch (err) {
        this.logger.error(`[DailyReconciliation] Manual run error for shift ${shift.id}: ${err?.message}`);
      }
    }

    return {
      workDate: targetDate,
      totalShifts: shifts.length,
      ...counts,
    };
  }
}
