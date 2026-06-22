import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { CalendarRequestEntity } from '../entity/calendar_request.entity';
import { LeaveBalanceEntity } from '../entity/leave_balance.entity';
import { CreateCalendarRequestDto, UpdateCalendarRequestDto, DeleteCalendarRequestDto, GetCalendarRequestsDto, ReviewCalendarRequestDto, ManualUnlockCalendarDto } from '../dto/calendar-request.dto';
import { CalendarUserLockEntity } from '../entity/calendar_user_lock.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { CalendarRequestResponseDto } from '../dto/calendar-response.dto';
import { CALENDAR_ERROR, DEFAULT_PAID_LEAVE_DAYS, AUTH_ERROR } from '@slack/constants';
import { CalendarRequestType, CalendarRequestStatus, CalendarRequestAction } from '../types/calendar.enum';
import { plainToInstance } from 'class-transformer';
import { IOffsetResponse } from '@slack/common';
import { CalendarCommonService } from './calendar-common.service';

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
  ) {}

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
          ...CALENDAR_ERROR.REQUEST_ALREADY_PROCESSED,
          message: 'Đơn này đã được xử lý hoặc đã bắt đầu, không thể thao tác.',
        });
      }
    }

    return request;
  }

  private async handleLeaveApproval(manager: EntityManager, request: CalendarRequestEntity) {
    if (request.requestType === CalendarRequestType.LEAVE_PAID) {
      const year = request.startTime.getFullYear();
      const policy = await this.policyService.getPolicy(request.workspaceId);
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
      } else {
        balance.totalPaidLeave = maxPaidLeaveDays;
      }

      const available = balance.totalPaidLeave - balance.usedPaidLeave;
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

    await manager.createQueryBuilder()
      .delete()
      .from(WorkShiftEntity)
      .where('workspaceId = :workspaceId', { workspaceId: request.workspaceId })
      .andWhere('userId = :userId', { userId: request.userId })
      .andWhere('workDate >= :startDateStr', { startDateStr })
      .andWhere('workDate <= :endDateStr', { endDateStr })
      .execute();
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
      await this.calendarCommonService.fetchMember(workspaceId, userId);

      const startObj = new Date(startTime as unknown as string);
      const endObj = new Date(endTime as unknown as string);
      const year = startObj.getFullYear();
      const actualDuration = durationDays ?? 1.0;

      return await this.requestRepository.manager.transaction(async (manager) => {
        // 2. Check for overlapping requests (PENDING or APPROVED)
        await this.checkOverlappingRequest(manager, workspaceId, userId, startObj, endObj);

        // 3. If it's LEAVE_PAID, check balance with pessimistic lock to prevent concurrent overdrafts
        if (requestType === CalendarRequestType.LEAVE_PAID) {
          await this.checkLeaveBalance(manager, workspaceId, userId, year, actualDuration);
        }

        // 4. Save request
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
        const requester = await this.calendarCommonService.fetchMember(workspaceId, userId);
        this.queueService.addJob(EQueueName.CALENDAR_QUEUE, EJobName.CALENDAR_REQUEST_CREATED, {
          requestId: saved.id,
          workspaceId,
          requesterId: userId,
          requesterName: requester.name,
          requestType,
          durationDays: actualDuration,
        });

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
      return await this.requestRepository.manager.transaction(async (manager) => {
        const request = await this.findAndValidateRequest(manager, id, workspaceId, userId);

        const startObj = startTime ? new Date(startTime as unknown as string) : request.startTime;
        const endObj = endTime ? new Date(endTime as unknown as string) : request.endTime;
        const actualDuration = durationDays ?? request.durationDays;
        const actualRequestType = requestType ?? request.requestType;
        const year = startObj.getFullYear();

        await this.checkOverlappingRequest(manager, workspaceId, userId, startObj, endObj, request.id);

        if (actualRequestType === CalendarRequestType.LEAVE_PAID) {
          await this.checkLeaveBalance(manager, workspaceId, userId, year, actualDuration);
        }

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
      return await this.requestRepository.manager.transaction(async (manager) => {
        const request = await this.findAndValidateRequest(manager, id, workspaceId, userId, true);

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

        await manager.remove(CalendarRequestEntity, request);
        return { success: true, message: 'Deleted calendar request successfully' };
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

        request.status = action === CalendarRequestAction.APPROVE ? CalendarRequestStatus.APPROVED : CalendarRequestStatus.REJECTED;
        request.approvedBy = reviewerId;

        if (action === CalendarRequestAction.REJECT && reviewNotes) {
          request.rejectReason = reviewNotes;
        } else if (reviewNotes) {
          request.metaData = { ...(request.metaData || {}), reviewNotes };
        }

        if (action === CalendarRequestAction.APPROVE) {
          if (request.requestType === CalendarRequestType.LEAVE_PAID || request.requestType === CalendarRequestType.LEAVE_UNPAID) {
            await this.handleLeaveApproval(manager, request);
          } else if (request.requestType === CalendarRequestType.CALENDAR_OPEN_REQUEST) {
            await this.handleCalendarOpenApproval(manager, request, reviewerId);
          }
        }

        const saved = await manager.save(CalendarRequestEntity, request);

        // Notify users
        const requester = await this.calendarCommonService.fetchMember(workspaceId, request.userId);

        this.queueService.addJob(EQueueName.CALENDAR_QUEUE, EJobName.CALENDAR_REQUEST_REVIEWED, {
          requestId: saved.id,
          workspaceId,
          requesterId: requester.userId,
          reviewerId: reviewerId,
          reviewerName: reviewer.name,
          status: saved.status,
        });

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
}
