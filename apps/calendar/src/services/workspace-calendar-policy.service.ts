import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { WorkspaceCalendarPolicyEntity } from '../entity/workspace_calendar_policy.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { CalendarUserLockEntity } from '../entity/calendar_user_lock.entity';
import { CALENDAR_ERROR } from '@slack/constants';
import { getMondayOfWeek, getSundayOfWeek, getLastDayOfMonth, calculateDiffHours } from '@slack/common/utils/time.util';
import { ShiftLocation } from '../types/calendar.enum';
import { WorkShiftValidationPayload } from '../types/calendar.type';
import { Logger } from '@nestjs/common';
import { CreateCalendarPolicyDto, UpdateCalendarPolicyDto, DeleteCalendarPolicyDto } from '../dto/calendar-request.dto';
import { WorkspaceCalendarPolicyResponseDto } from '../dto/calendar-response.dto';
import { CACHE, TTL } from '@slack/cached/cached.constant';
import { CachedService } from '@slack/cached/cached.service';
import { plainToInstance } from 'class-transformer';
import { CalendarCommonService } from './calendar-common.service';

@Injectable()
export class WorkspaceCalendarPolicyService {
  private readonly logger = new Logger(WorkspaceCalendarPolicyService.name);

  constructor(
    @InjectRepository(WorkspaceCalendarPolicyEntity)
    private readonly policyRepository: Repository<WorkspaceCalendarPolicyEntity>,
    @InjectRepository(WorkShiftEntity)
    private readonly workShiftRepository: Repository<WorkShiftEntity>,
    @InjectRepository(CalendarUserLockEntity)
    private readonly userLockRepository: Repository<CalendarUserLockEntity>,
    private readonly calendarCommonService: CalendarCommonService,
    private readonly cachedService: CachedService,
  ) { }

  async getPolicy(workspaceId: string): Promise<WorkspaceCalendarPolicyResponseDto | null> {
    return this.cachedService.getOrSetDetail(
      CACHE.CALENDAR.KEYS.POLICY(workspaceId),
      TTL.LONG,
      async () => {
        const policy = await this.policyRepository.findOne({ where: { workspaceId } });
        if (!policy) return null;
        return plainToInstance(WorkspaceCalendarPolicyResponseDto, policy);
      }
    );
  }

  async validateShifts(
    workspaceId: string,
    userId: string,
    memberEmploymentType: string | undefined,
    memberRole: string,
    shifts: WorkShiftValidationPayload[]
  ) {
    const policy = await this.getPolicy(workspaceId);
    const maxWfhDaysPerWeek = policy?.policyData?.maxWfhDaysPerWeek ?? 4;
    const maxFullTimeHours = policy?.policyData?.maxFullTimeHours ?? 208;
    const maxPartTimeHours = policy?.policyData?.maxPartTimeHours ?? 120;

    const empType = memberEmploymentType || 'FULLTIME';
    const maxHours = empType === 'PARTTIME' ? maxPartTimeHours : maxFullTimeHours;

    const wfhDatesSet = new Set<string>();
    const monthMap = new Map<string, { newHours: number, dateStrs: Set<string> }>();

    // 0. Check Lock Deadline
    await this.checkLockDeadline(workspaceId, memberRole, userId, shifts.map(s => s.workDate));

    for (const shift of shifts) {
      if (shift.location === ShiftLocation.WFH) {
        wfhDatesSet.add(shift.workDate);
      }

      const month = shift.workDate.substring(0, 7); // '2026-06'
      if (!monthMap.has(month)) monthMap.set(month, { newHours: 0, dateStrs: new Set() });
      const mapData = monthMap.get(month)!;
      mapData.dateStrs.add(shift.workDate);
      const hours = calculateDiffHours(shift.startTime, shift.endTime);
      mapData.newHours += hours;
    }

    // 1. Calculate boundaries to fetch everything in ONE query
    let minDate = '9999-12-31';
    let maxDate = '0000-01-01';

    const weekMap = new Map<string, Set<string>>();
    for (const date of wfhDatesSet) {
      const monday = getMondayOfWeek(date);
      if (!weekMap.has(monday)) weekMap.set(monday, new Set());
      weekMap.get(monday)!.add(date);

      const sunday = getSundayOfWeek(monday);

      if (monday < minDate) minDate = monday;
      if (sunday > maxDate) maxDate = sunday;
    }

    for (const month of monthMap.keys()) {
      const firstDay = `${month}-01`;
      const lastDay = getLastDayOfMonth(month);

      if (firstDay < minDate) minDate = firstDay;
      if (lastDay > maxDate) maxDate = lastDay;
    }

    // 2. Fetch all existing shifts for the affected period in a SINGLE DB query
    let existingShifts: WorkShiftEntity[] = [];
    if (minDate <= maxDate) {
      existingShifts = await this.workShiftRepository.find({
        where: {
          workspaceId,
          userId,
          workDate: Between(minDate, maxDate),
        }
      });
    }

    // 3. Validate WFH Days per Week Limit in memory
    for (const [monday, newDates] of weekMap.entries()) {
      const sunday = getSundayOfWeek(monday);

      const wfhShiftsInWeek = existingShifts.filter(
        s => s.location === ShiftLocation.WFH && s.workDate >= monday && s.workDate <= sunday
      );

      const allWfhDatesInWeek = new Set(wfhShiftsInWeek.map(s => s.workDate));
      for (const d of newDates) {
        allWfhDatesInWeek.add(d);
      }

      if (allWfhDatesInWeek.size > maxWfhDaysPerWeek) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.WFH_LIMIT_EXCEEDED,
          message: `Vượt quá ${maxWfhDaysPerWeek} ngày WFH/tuần`,
        });
      }
    }

    // 4. Validate Max Hours per Month Limit in memory
    for (const [month, data] of monthMap.entries()) {
      const monthPrefix = `${month}-`;
      const shiftsInMonth = existingShifts.filter(s => s.workDate.startsWith(monthPrefix));

      let existingHours = 0;
      for (const s of shiftsInMonth) {
        // Exclude the shifts we are updating or replacing
        const isBeingUpdated = shifts.some(newShift => (s.id && newShift.id === s.id) || newShift.workDate === s.workDate);
        if (!isBeingUpdated) {
          const h = calculateDiffHours(s.startTime, s.endTime);
          existingHours += h;
        }
      }

      if (existingHours + data.newHours > maxHours) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.MAX_HOURS_EXCEEDED,
          message: `Vượt quá giới hạn ${maxHours} giờ làm việc trong tháng`,
        });
      }
    }
  }

  async checkLockDeadline(workspaceId: string, memberRole: string, userId: string, workDates: string[]) {
    if (this.calendarCommonService.isPrivileged(memberRole)) return;

    const policy = await this.getPolicy(workspaceId);
    const lockDeadlineDay = policy?.policyData?.lockDeadlineDay ?? 25;
    const currentDate = new Date();
    const activeUnlockByMonth = new Map<string, boolean>();

    for (const workDate of workDates) {
      const shiftDate = new Date(workDate);
      const targetYear = shiftDate.getUTCFullYear();
      const targetMonth = shiftDate.getUTCMonth(); // 0-11
      const deadlineDate = new Date(Date.UTC(targetYear, targetMonth - 1, lockDeadlineDay, 23, 59, 59, 999));

      if (currentDate.getTime() <= deadlineDate.getTime()) continue;

      const targetMonthStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;

      if (!activeUnlockByMonth.has(targetMonthStr)) {
        const lockRecord = await this.userLockRepository.findOne({
          where: { workspaceId, userId, targetMonth: targetMonthStr },
        });
        activeUnlockByMonth.set(
          targetMonthStr,
          !!(lockRecord?.isUnlocked && lockRecord.unlockExpiresAt > currentDate),
        );
      }

      if (activeUnlockByMonth.get(targetMonthStr)) continue;

      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...CALENDAR_ERROR.CALENDAR_LOCKED,
        message: `Lịch đăng ký cho tháng ${targetMonth + 1}/${targetYear} đã khóa từ ngày ${lockDeadlineDay}/${targetMonth === 0 ? 12 : targetMonth}. Vui lòng liên hệ Admin.`,
      });
    }
  }

  async createPolicy(dto: CreateCalendarPolicyDto): Promise<WorkspaceCalendarPolicyResponseDto> {
    const member = await this.calendarCommonService.fetchMember(dto.workspaceId, dto.userId);
    this.calendarCommonService.assertPrivileged(member.role);

    const existingPolicy = await this.getPolicy(dto.workspaceId);
    if (existingPolicy) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.POLICY_ALREADY_EXISTS,
      });
    }

    try {
      const newPolicy = this.policyRepository.create({
        workspaceId: dto.workspaceId,
        policyData: dto.policyData,
      });
      const savedPolicy = await this.policyRepository.save(newPolicy);
      await this.cachedService.del(CACHE.CALENDAR.KEYS.POLICY(dto.workspaceId));
      return plainToInstance(WorkspaceCalendarPolicyResponseDto, savedPolicy);
    } catch (error) {
      this.logger.error(`Error creating policy: ${error.message}`);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.CREATE_POLICY_FAILED,
      });
    }
  }

  async updatePolicy(dto: UpdateCalendarPolicyDto): Promise<WorkspaceCalendarPolicyResponseDto> {
    const member = await this.calendarCommonService.fetchMember(dto.workspaceId, dto.userId);
    this.calendarCommonService.assertPrivileged(member.role);

    const existingPolicyEntity = await this.policyRepository.findOne({ where: { workspaceId: dto.workspaceId } });
    if (!existingPolicyEntity) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...CALENDAR_ERROR.CALENDAR_POLICY_NOT_FOUND,
      });
    }

    try {
      existingPolicyEntity.policyData = { ...existingPolicyEntity.policyData, ...dto.policyData };
      const updatedPolicy = await this.policyRepository.save(existingPolicyEntity);
      await this.cachedService.del(CACHE.CALENDAR.KEYS.POLICY(dto.workspaceId));
      return plainToInstance(WorkspaceCalendarPolicyResponseDto, updatedPolicy);
    } catch (error) {
      this.logger.error(`Error updating policy: ${error.message}`);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.UPDATE_POLICY_FAILED,
      });
    }
  }

  async deletePolicy(dto: DeleteCalendarPolicyDto) {
    const member = await this.calendarCommonService.fetchMember(dto.workspaceId, dto.userId);
    this.calendarCommonService.assertPrivileged(member.role);

    try {
      const result = await this.policyRepository.delete({ workspaceId: dto.workspaceId });
      if (result.affected === 0) {
        throw new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.CALENDAR_POLICY_NOT_FOUND,
        });
      }
      await this.cachedService.del(CACHE.CALENDAR.KEYS.POLICY(dto.workspaceId));
      return { success: true, message: 'Policy deleted successfully' };
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`Error deleting policy: ${error.message}`);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.DELETE_POLICY_FAILED,
      });
    }
  }
}
