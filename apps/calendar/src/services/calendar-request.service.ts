import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In, Between } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { CalendarRequestEntity } from '../entity/calendar_request.entity';
import { LeaveBalanceEntity } from '../entity/leave_balance.entity';
import { CreateCalendarRequestDto, UpdateCalendarRequestDto, DeleteCalendarRequestDto, GetCalendarRequestsDto, ReviewCalendarRequestDto, ManualUnlockCalendarDto } from '../dto/calendar-request.dto';
import { CalendarUserLockEntity } from '../entity/calendar_user_lock.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { AttendanceLogEntity } from '../entity/attendance_log.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { CalendarRequestResponseDto } from '../dto/calendar-response.dto';
import { CALENDAR_ERROR, DEFAULT_PAID_LEAVE_DAYS, AUTH_ERROR } from '@slack/constants';
import { CalendarRequestType, CalendarRequestStatus, CalendarRequestAction, DailyReconciliationStatus } from '../types/calendar.enum';
import { plainToInstance } from 'class-transformer';
import { IOffsetResponse } from '@slack/common';
import { CalendarCommonService } from './calendar-common.service';
import { WorkspaceHolidayService } from './workspace-holiday.service';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { EQueueName, EJobName, QueueService } from '@slack/queue';

@Injectable()
export class CalendarRequestService {
  private readonly logger = new Logger(CalendarRequestService.name);

  constructor(
    @InjectRepository(CalendarRequestEntity)
    private readonly requestRepository: Repository<CalendarRequestEntity>,
    private readonly calendarCommonService: CalendarCommonService,
    private readonly policyService: WorkspaceCalendarPolicyService,
    private readonly queueService: QueueService,
    private readonly holidayService: WorkspaceHolidayService,
  ) { }

  private getWorkdaysBetween(startTime: Date, endTime: Date, workingDays: number[] = [1, 2, 3, 4, 5]): string[] {
    const dates: string[] = [];
    const cursor = new Date(startTime);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = new Date(endTime);
    end.setUTCHours(23, 59, 59, 999);
    while (cursor <= end) {
      if (workingDays.includes(cursor.getUTCDay())) {
        dates.push(cursor.toISOString().split('T')[0]);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  private async calculateMaxWorkingDays(workspaceId: string, startTime: Date, endTime: Date): Promise<number> {
    const policy = await this.policyService.getPolicy(workspaceId);
    const workingDays = policy?.policyData?.workingDays ?? [1, 2, 3, 4, 5];
    const datesToCheck = this.getWorkdaysBetween(startTime, endTime, workingDays);
    if (datesToCheck.length === 0) return 0;
    const holidaysMap = await this.holidayService.checkIfDatesAreHolidays(workspaceId, datesToCheck);
    return datesToCheck.filter(d => !holidaysMap[d]).length;
  }

  private async checkLeaveBalance(manager: EntityManager, workspaceId: string, userId: string, year: number, actualDuration: number) {
    const balance = await manager.findOne(LeaveBalanceEntity, {
      where: { workspaceId, userId, year },
      lock: { mode: 'pessimistic_write' },
    });

    const policy = await this.policyService.getPolicy(workspaceId);
    const maxPaidLeaveDays = policy?.policyData?.maxPaidLeaveDaysPerYear ?? DEFAULT_PAID_LEAVE_DAYS;

    const available = balance ? maxPaidLeaveDays - balance.usedPaidLeave : maxPaidLeaveDays;

    if (available < actualDuration) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.INSUFFICIENT_LEAVE_BALANCE,
        message: `${CALENDAR_ERROR.INSUFFICIENT_LEAVE_BALANCE.message}. Bạn còn ${available} ngày phép năm.`,
      });
    }
  }

  private async findAndValidateRequest(manager: EntityManager, id: string, workspaceId: string, userId?: string, allowApprovedAndFuture = false) {
    const request = await manager.findOne(CalendarRequestEntity, {
      where: { id, workspaceId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!request) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...CALENDAR_ERROR.LEAVE_REQUEST_NOT_FOUND,
      });
    }

    if (userId && request.userId !== userId) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...AUTH_ERROR.FORBIDDEN,
      });
    }

    if (request.status !== CalendarRequestStatus.PENDING) {
      if (!allowApprovedAndFuture || request.status !== CalendarRequestStatus.APPROVED || new Date() >= request.startTime) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.REQUEST_ALREADY_PROCESSED_OR_STARTED,
        });
      }
    }

    return request;
  }

  private async handleLeaveApproval(manager: EntityManager, request: CalendarRequestEntity): Promise<number> {
    const policy = await this.policyService.getPolicyDirect(request.workspaceId);
    const workingDays: number[] = policy?.policyData?.workingDays ?? [1, 2, 3, 4, 5];

    if (request.requestType === CalendarRequestType.LEAVE_PAID) {
      const year = request.startTime.getFullYear();
      const maxPaidLeaveDays = policy?.policyData?.maxPaidLeaveDaysPerYear ?? DEFAULT_PAID_LEAVE_DAYS;

      let balance = await manager.findOne(LeaveBalanceEntity, {
        where: { workspaceId: request.workspaceId, userId: request.userId, year },
        lock: { mode: 'pessimistic_write' },
      });

      if (!balance) {
        balance = manager.create(LeaveBalanceEntity, {
          workspaceId: request.workspaceId,
          userId: request.userId,
          year,
          totalPaidLeave: maxPaidLeaveDays,
          usedPaidLeave: 0,
        });
      }

      const available = maxPaidLeaveDays - balance.usedPaidLeave;
      if (available < request.durationDays) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.INSUFFICIENT_LEAVE_BALANCE,
          message: `Không đủ ngày phép. Hiện tại nhân viên chỉ còn ${available} ngày.`,
        });
      }

      balance.usedPaidLeave += request.durationDays;
      await manager.save(LeaveBalanceEntity, balance);
    }

    // Xóa ca làm việc trong khoảng thời gian nghỉ
    const startDateStr = request.startTime.toISOString().split('T')[0];
    const endDateStr = request.endTime.toISOString().split('T')[0];

    // Trước khi xóa shifts, null-out workShiftId trong attendance logs liên quan
    // để tránh FK violation hoặc orphaned records
    const shiftsInRange = await manager.find(WorkShiftEntity, {
      where: {
        workspaceId: request.workspaceId,
        userId: request.userId,
        workDate: Between(startDateStr, endDateStr),
      },
      select: ['id'],
    });
    if (shiftsInRange.length > 0) {
      const shiftIds = shiftsInRange.map(s => s.id);
      await manager.createQueryBuilder()
        .update(AttendanceLogEntity)
        .set({ workShiftId: null })
        .where('workShiftId IN (:...shiftIds)', { shiftIds })
        .execute();
    }

    const deleteResult = await manager.createQueryBuilder()
      .delete()
      .from(WorkShiftEntity)
      .where('workspaceId = :workspaceId', { workspaceId: request.workspaceId })
      .andWhere('userId = :userId', { userId: request.userId })
      .andWhere('workDate >= :startDateStr', { startDateStr })
      .andWhere('workDate <= :endDateStr', { endDateStr })
      .execute();

    const deletedShiftsCount = deleteResult.affected ?? 0;

    // Tạo reconciliation record cho từng ngày làm việc trong khoảng nghỉ,
    // đảm bảo thống kê cuối tháng hiển thị đúng trạng thái thay vì bị trống hoặc ABSENT.
    const reconciliationStatus = request.requestType === CalendarRequestType.LEAVE_PAID
      ? DailyReconciliationStatus.LEAVE_PAID_APPROVED
      : DailyReconciliationStatus.LEAVE_UNPAID_APPROVED;

    const workdays = this.getWorkdaysBetween(request.startTime, request.endTime, workingDays);
    if (workdays.length === 0) return deletedShiftsCount;

    const holidaysMap = await this.holidayService.checkIfDatesAreHolidays(request.workspaceId, workdays);
    const leaveDates = workdays.filter(d => !holidaysMap[d]);

    const existingRecords = await manager.find(DailyReconciliationEntity, {
      where: { workspaceId: request.workspaceId, userId: request.userId, workDate: In(leaveDates) },
    });
    const existingMap = new Map(existingRecords.map(r => [r.workDate, r]));

    const toSave = leaveDates.map(workDate => {
      const existing = existingMap.get(workDate);
      if (existing) {
        existing.status = reconciliationStatus;
        return existing;
      }
      return manager.create(DailyReconciliationEntity, {
        workspaceId: request.workspaceId,
        userId: request.userId,
        workDate,
        status: reconciliationStatus,
      });
    });

    await manager.save(DailyReconciliationEntity, toSave);
    return deletedShiftsCount;
  }

  private async handleCalendarOpenApproval(manager: EntityManager, request: CalendarRequestEntity, reviewerId: string) {
    const targetMonth = request.startTime.toISOString().substring(0, 7); // YYYY-MM
    let lock = await manager.findOne(CalendarUserLockEntity, {
      where: { workspaceId: request.workspaceId, userId: request.userId, targetMonth }
    });

    if (!lock) {
      lock = manager.create(CalendarUserLockEntity, {
        workspaceId: request.workspaceId,
        userId: request.userId,
        targetMonth,
      });
    }

    lock.isUnlocked = true;
    lock.unlockedBy = reviewerId;
    lock.unlockReason = `Approved open request ${request.id}`;

    const expires = new Date();
    expires.setDate(expires.getDate() + 1); // Mở khóa trong 24h
    lock.unlockExpiresAt = expires;

    await manager.save(CalendarUserLockEntity, lock);
  }

  private async checkOverlappingRequest(
    manager: EntityManager,
    workspaceId: string,
    userId: string,
    startObj: Date,
    endObj: Date,
    excludeRequestId?: string,
  ) {
    const query = manager.createQueryBuilder(CalendarRequestEntity, 'req')
      .where('req.workspaceId = :workspaceId', { workspaceId })
      .andWhere('req.userId = :userId', { userId })
      .andWhere('req.status IN (:...statuses)', {
        statuses: [CalendarRequestStatus.PENDING, CalendarRequestStatus.APPROVED]
      })
      .andWhere('req.startTime < :endObj', { endObj })
      .andWhere('req.endTime > :startObj', { startObj });

    if (excludeRequestId) {
      query.andWhere('req.id != :excludeRequestId', { excludeRequestId });
    }

    const overlappingRequest = await query.getOne();

    if (overlappingRequest) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.OVERLAPPING_REQUEST,
      });
    }
  }

  async createRequest(dto: CreateCalendarRequestDto) {
    const { workspaceId, userId, requestType, startTime, endTime, durationDays, reason, metaData } = dto;

    try {
      // 1. Validate membership
      const member = await this.calendarCommonService.fetchMember(workspaceId, userId);

      const startObj = new Date(startTime as unknown as string);
      const endObj = new Date(endTime as unknown as string);

      if (startObj >= endObj) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.INVALID_TIME_RANGE,
        });
      }

      let actualDuration = durationDays ?? 1.0;

      if (requestType === CalendarRequestType.LEAVE_PAID || requestType === CalendarRequestType.LEAVE_UNPAID) {
        const maxWorkingDays = await this.calculateMaxWorkingDays(workspaceId, startObj, endObj);
        if (actualDuration > maxWorkingDays) {
          actualDuration = maxWorkingDays;
        }
      }

      // 1.5. Check lock deadline
      if (requestType !== CalendarRequestType.CALENDAR_OPEN_REQUEST) {
        await this.policyService.checkLockDeadline(workspaceId, member.role, userId, [startObj.toISOString().split('T')[0]]);
      }

      return await this.requestRepository.manager.transaction(async (manager) => {
        // 2. Check for overlapping requests (PENDING or APPROVED)
        await this.checkOverlappingRequest(manager, workspaceId, userId, startObj, endObj);

        // 3. Save request
        const newRequest = manager.create(CalendarRequestEntity, {
          workspaceId,
          userId,
          requestType,
          startTime: startObj,
          endTime: endObj,
          durationDays: actualDuration,
          reason,
          metaData,
        });

        const saved = await manager.save(CalendarRequestEntity, newRequest);

        // Push notification job
        this.queueService.addJob(EQueueName.CALENDAR_QUEUE, EJobName.CALENDAR_REQUEST_CREATED, {
          requestId: saved.id,
          workspaceId,
          requesterId: userId,
          requesterName: member.name,
          requestType,
          durationDays: actualDuration,
        }).catch(err => this.logger.error('Failed to dispatch CALENDAR_REQUEST_CREATED job', err));

        return plainToInstance(CalendarRequestResponseDto, saved);
      });
    } catch (error) {
      this.logger.error(`Error creating calendar request: ${error.message}`, error.stack);
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.CREATE_REQUEST_FAILED,
      });
    }
  }

  async updateRequest(dto: UpdateCalendarRequestDto) {
    const { id, workspaceId, userId, requestType, startTime, endTime, durationDays, reason, metaData } = dto;

    try {
      const member = await this.calendarCommonService.fetchMember(workspaceId, userId);

      return await this.requestRepository.manager.transaction(async (manager) => {
        const request = await this.findAndValidateRequest(manager, id, workspaceId, userId);

        const startObj = startTime ? new Date(startTime as unknown as string) : request.startTime;
        const endObj = endTime ? new Date(endTime as unknown as string) : request.endTime;

        if (startObj >= endObj) {
          throw new RpcException({
            statusCode: HttpStatus.BAD_REQUEST,
            ...CALENDAR_ERROR.INVALID_TIME_RANGE,
          });
        }

        const actualRequestType = requestType ?? request.requestType;
        let actualDuration = durationDays ?? request.durationDays;

        if (actualRequestType === CalendarRequestType.LEAVE_PAID || actualRequestType === CalendarRequestType.LEAVE_UNPAID) {
          const maxWorkingDays = await this.calculateMaxWorkingDays(workspaceId, startObj, endObj);
          if (actualDuration > maxWorkingDays) {
            actualDuration = maxWorkingDays;
          }
        }
        const datesToCheck = [request.startTime.toISOString().split('T')[0]];
        if (startObj.toISOString() !== request.startTime.toISOString()) {
          datesToCheck.push(startObj.toISOString().split('T')[0]);
        }

        if (actualRequestType !== CalendarRequestType.CALENDAR_OPEN_REQUEST) {
          await this.policyService.checkLockDeadline(workspaceId, member.role, userId, datesToCheck);
        }

        await this.checkOverlappingRequest(manager, workspaceId, userId, startObj, endObj, request.id);

        manager.merge(CalendarRequestEntity, request, {
          ...(requestType && { requestType }),
          ...(startTime && { startTime: startObj }),
          ...(endTime && { endTime: endObj }),
          ...(durationDays !== undefined && { durationDays: actualDuration }),
          ...(reason && { reason }),
          ...(metaData && { metaData }),
        });

        const saved = await manager.save(CalendarRequestEntity, request);
        return plainToInstance(CalendarRequestResponseDto, saved);
      });
    } catch (error) {
      this.logger.error(`Error updating calendar request: ${error.message}`, error.stack);
      if (error instanceof RpcException) throw error;
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.UPDATE_REQUEST_FAILED,
      });
    }
  }

  async deleteRequest(dto: DeleteCalendarRequestDto) {
    const { id, workspaceId, userId } = dto;

    try {
      const member = await this.calendarCommonService.fetchMember(workspaceId, userId);

      return await this.requestRepository.manager.transaction(async (manager) => {
        const request = await this.findAndValidateRequest(manager, id, workspaceId, userId, true);

        if (request.requestType !== CalendarRequestType.CALENDAR_OPEN_REQUEST) {
          await this.policyService.checkLockDeadline(workspaceId, member.role, userId, [request.startTime.toISOString().split('T')[0]]);
        }

        // Refund leave balance if deleting an APPROVED LEAVE_PAID request
        if (request.status === CalendarRequestStatus.APPROVED && request.requestType === CalendarRequestType.LEAVE_PAID) {
          const year = request.startTime.getFullYear();
          const balance = await manager.findOne(LeaveBalanceEntity, {
            where: { workspaceId, userId: request.userId, year },
            lock: { mode: 'pessimistic_write' },
          });

          if (balance) {
            balance.usedPaidLeave = Math.max(0, balance.usedPaidLeave - request.durationDays);
            await manager.save(LeaveBalanceEntity, balance);
          }
        }

        // Revert reconciliation records created when leave was approved
        if (
          request.status === CalendarRequestStatus.APPROVED &&
          (request.requestType === CalendarRequestType.LEAVE_PAID || request.requestType === CalendarRequestType.LEAVE_UNPAID)
        ) {
          const deletePolicy = await this.policyService.getPolicy(workspaceId);
          const deleteWorkingDays: number[] = deletePolicy?.policyData?.workingDays ?? [1, 2, 3, 4, 5];
          const workdays = this.getWorkdaysBetween(request.startTime, request.endTime, deleteWorkingDays);
          if (workdays.length > 0) {
            await manager.delete(DailyReconciliationEntity, {
              workspaceId: request.workspaceId,
              userId: request.userId,
              workDate: In(workdays),
              status: In([DailyReconciliationStatus.LEAVE_PAID_APPROVED, DailyReconciliationStatus.LEAVE_UNPAID_APPROVED]),
            });
          }
        }

        // Revoke unlock window when cancelling an approved CALENDAR_OPEN_REQUEST
        if (request.status === CalendarRequestStatus.APPROVED && request.requestType === CalendarRequestType.CALENDAR_OPEN_REQUEST) {
          const targetMonthStr = request.startTime.toISOString().substring(0, 7);
          const lock = await manager.findOne(CalendarUserLockEntity, {
            where: { workspaceId: request.workspaceId, userId: request.userId, targetMonth: targetMonthStr },
          });
          if (lock) {
            lock.isUnlocked = false;
            await manager.save(CalendarUserLockEntity, lock);
          }
        }

        request.status = CalendarRequestStatus.CANCELLED;
        await manager.save(CalendarRequestEntity, request);
        return { success: true, message: 'Cancelled calendar request successfully' };
      });
    } catch (error) {
      this.logger.error(`Error deleting calendar request: ${error.message}`, error.stack);
      if (error instanceof RpcException) throw error;
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.DELETE_REQUEST_FAILED,
      });
    }
  }

  async getRequests(dto: GetCalendarRequestsDto): Promise<IOffsetResponse<CalendarRequestResponseDto[]>> {
    const { workspaceId, userId, targetUserId, status, type, page = 1, limit = 20 } = dto;

    const member = await this.calendarCommonService.fetchMember(workspaceId, userId);

    // Regular members can only see their own requests
    const effectiveTargetUserId = this.calendarCommonService.isPrivileged(member.role) ? targetUserId : userId;

    const skip = (page - 1) * limit;

    const query = this.requestRepository
      .createQueryBuilder('request')
      .where('request.workspaceId = :workspaceId', { workspaceId });

    if (effectiveTargetUserId) {
      query.andWhere('request.userId = :effectiveTargetUserId', { effectiveTargetUserId });
    }

    if (status) {
      query.andWhere('request.status = :status', { status });
    }

    if (type) {
      query.andWhere('request.requestType = :type', { type });
    }

    query.orderBy('request.createdAt', 'DESC');
    query.skip(skip).take(limit);

    const [items, total] = await query.getManyAndCount();

    const responseData = items.map((item) => plainToInstance(CalendarRequestResponseDto, item));

    return {
      data: responseData,
      paging: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    } as unknown as IOffsetResponse<CalendarRequestResponseDto[]>;
  }

  async reviewRequest(dto: ReviewCalendarRequestDto) {
    const { id, workspaceId, reviewerId, action, reviewNotes } = dto;

    try {
      // 1. Verify reviewer is a manager/admin
      const reviewer = await this.calendarCommonService.fetchMember(workspaceId, reviewerId);
      this.calendarCommonService.assertPrivileged(reviewer.role);

      return await this.requestRepository.manager.transaction(async (manager) => {
        // Dùng undefined cho userId để bỏ qua check người gửi đơn (vì đây là Manager duyệt)
        const request = await this.findAndValidateRequest(manager, id, workspaceId, undefined);

        const requester = await this.calendarCommonService.fetchMember(workspaceId, request.userId);

        request.status = action === CalendarRequestAction.APPROVE ? CalendarRequestStatus.APPROVED : CalendarRequestStatus.REJECTED;
        request.approvedBy = reviewerId;

        if (action === CalendarRequestAction.REJECT && reviewNotes) {
          request.rejectReason = reviewNotes;
        } else if (reviewNotes) {
          request.metaData = { ...(request.metaData || {}), reviewNotes };
        }

        let deletedShiftsCount = 0;
        if (action === CalendarRequestAction.APPROVE) {
          if (request.requestType === CalendarRequestType.LEAVE_PAID || request.requestType === CalendarRequestType.LEAVE_UNPAID) {
            deletedShiftsCount = await this.handleLeaveApproval(manager, request);
          } else if (request.requestType === CalendarRequestType.CALENDAR_OPEN_REQUEST) {
            await this.handleCalendarOpenApproval(manager, request, reviewerId);
          }
        }

        const saved = await manager.save(CalendarRequestEntity, request);

        // Notify users
        this.queueService.addJob(EQueueName.CALENDAR_QUEUE, EJobName.CALENDAR_REQUEST_REVIEWED, {
          requestId: saved.id,
          workspaceId,
          requesterId: requester.userId,
          reviewerId: reviewerId,
          reviewerName: reviewer.name,
          status: saved.status,
          deletedShiftsCount,
        }).catch(err => this.logger.error('Failed to dispatch CALENDAR_REQUEST_REVIEWED job', err));

        return plainToInstance(CalendarRequestResponseDto, saved);
      });
    } catch (error) {
      this.logger.error(`Error reviewing calendar request: ${error.message}`, error.stack);
      if (error instanceof RpcException) throw error;
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.REVIEW_REQUEST_FAILED,
      });
    }
  }

  async manualUnlock(dto: ManualUnlockCalendarDto) {
    const { workspaceId, reviewerId, targetUserId, targetMonth, reason } = dto;

    try {
      // 1. Verify reviewer is a manager/admin
      const reviewer = await this.calendarCommonService.fetchMember(workspaceId, reviewerId);
      this.calendarCommonService.assertPrivileged(reviewer.role);

      // 2. Insert or update CalendarUserLockEntity directly
      return await this.requestRepository.manager.transaction(async (manager) => {
        let lock = await manager.findOne(CalendarUserLockEntity, {
          where: { workspaceId, userId: targetUserId, targetMonth },
        });

        if (!lock) {
          lock = manager.create(CalendarUserLockEntity, {
            workspaceId,
            userId: targetUserId,
            targetMonth,
          });
        }

        lock.isUnlocked = true;
        lock.unlockedBy = reviewerId;
        lock.unlockReason = reason || 'Manual unlock by manager';

        const expires = new Date();
        expires.setDate(expires.getDate() + 1); // Unlock for 24h by default
        lock.unlockExpiresAt = expires;

        await manager.save(CalendarUserLockEntity, lock);

        return { success: true, message: 'Unlocked calendar successfully' };
      });
    } catch (error) {
      this.logger.error(`Error manually unlocking calendar: ${error.message}`, error.stack);
      if (error instanceof RpcException) throw error;
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.MANUAL_UNLOCK_FAILED,
      });
    }
  }

  async getMyLockStatus(workspaceId: string, userId: string, targetMonth: string) {
    const now = new Date();
    const lock = await this.requestRepository.manager.findOne(CalendarUserLockEntity, {
      where: { workspaceId, userId, targetMonth },
    });
    const isUnlocked = !!(lock?.isUnlocked && lock.unlockExpiresAt != null && lock.unlockExpiresAt > now);
    return {
      isUnlocked,
      unlockExpiresAt: isUnlocked ? lock!.unlockExpiresAt!.toISOString() : null,
    };
  }

  async getMonthLockStatus(workspaceId: string, requestorId: string, targetMonth: string) {
    const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
    this.calendarCommonService.assertPrivileged(requestor.role);

    const now = new Date();
    const locks = await this.requestRepository.manager.find(CalendarUserLockEntity, {
      where: { workspaceId, targetMonth },
    });

    return locks.map(lock => ({
      userId: lock.userId,
      isUnlocked: lock.isUnlocked && lock.unlockExpiresAt != null && lock.unlockExpiresAt > now,
      unlockExpiresAt: lock.unlockExpiresAt?.toISOString() ?? null,
    }));
  }
}
