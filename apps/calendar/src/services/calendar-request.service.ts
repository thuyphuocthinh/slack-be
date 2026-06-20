import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { RpcException, ClientProxy } from '@nestjs/microservices';
import { CalendarRequestEntity } from '../entity/calendar_request.entity';
import { LeaveBalanceEntity } from '../entity/leave_balance.entity';
import { CreateCalendarRequestDto, UpdateCalendarRequestDto, DeleteCalendarRequestDto, GetCalendarRequestsDto } from '../dto/calendar-request.dto';
import { CalendarRequestResponseDto } from '../dto/calendar-response.dto';
import { WORKSPACE_MESSAGE_PATTERNS, NAME_SERVICE_TCP, CALENDAR_ERROR, DEFAULT_PAID_LEAVE_DAYS, WorkspaceRoleEnum } from '@slack/constants';
import { CalendarRequestType, CalendarRequestStatus } from '../types/calendar.enum';
import { firstValueFrom } from 'rxjs';
import { plainToInstance } from 'class-transformer';
import { IOffsetResponse } from '@slack/common';

@Injectable()
export class CalendarRequestService {
  private readonly logger = new Logger(CalendarRequestService.name);

  constructor(
    @InjectRepository(CalendarRequestEntity)
    private readonly requestRepository: Repository<CalendarRequestEntity>,
    @InjectRepository(LeaveBalanceEntity)
    private readonly leaveBalanceRepository: Repository<LeaveBalanceEntity>,
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
  ) {}

  private async checkLeaveBalance(manager: EntityManager, workspaceId: string, userId: string, year: number, actualDuration: number) {
    const balance = await manager.findOne(LeaveBalanceEntity, {
      where: { workspaceId, userId, year },
      lock: { mode: 'pessimistic_write' },
    });

    const available = balance ? balance.totalPaidLeave - balance.usedPaidLeave : DEFAULT_PAID_LEAVE_DAYS;

    if (available < actualDuration) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.INSUFFICIENT_LEAVE_BALANCE,
        message: `${CALENDAR_ERROR.INSUFFICIENT_LEAVE_BALANCE.message}. Bạn còn ${available} ngày phép năm.`,
      });
    }
  }

  private async findAndValidateRequest(manager: EntityManager, id: string, workspaceId: string, userId: string) {
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

    if (request.userId !== userId) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...CALENDAR_ERROR.REQUEST_FORBIDDEN_ACTION,
      });
    }

    if (request.status !== CalendarRequestStatus.PENDING) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.REQUEST_NOT_PENDING,
      });
    }

    return request;
  }

  async createRequest(dto: CreateCalendarRequestDto) {
    const { workspaceId, userId, requestType, startTime, endTime, durationDays, reason, metaData } = dto;

    try {
      // 1. Validate membership
      const member = await firstValueFrom(
        this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
          workspaceId,
          userId,
        }),
      );

      if (!member) {
        throw new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.NOT_WORKSPACE_MEMBER,
        });
      }

      const startObj = new Date(startTime as unknown as string);
      const endObj = new Date(endTime as unknown as string);
      const year = startObj.getFullYear();
      const actualDuration = durationDays ?? 1.0;

      return await this.requestRepository.manager.transaction(async (manager) => {
        // 2. If it's LEAVE_PAID, check balance with pessimistic lock to prevent concurrent overdrafts
        if (requestType === CalendarRequestType.LEAVE_PAID) {
          await this.checkLeaveBalance(manager, workspaceId, userId, year, actualDuration);
        }

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
        const request = await this.findAndValidateRequest(manager, id, workspaceId, userId);

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
    
    // Check role to enforce permissions
    const member = await firstValueFrom(
      this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, { workspaceId, userId }),
    );

    if (!member) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...CALENDAR_ERROR.NOT_WORKSPACE_MEMBER,
      });
    }

    let actualTargetUserId = targetUserId;
    if (member.role === WorkspaceRoleEnum.MEMBER) {
      actualTargetUserId = userId; // Regular members can only see their own requests
    }

    const skip = (page - 1) * limit;

    const query = this.requestRepository
      .createQueryBuilder('request')
      .where('request.workspaceId = :workspaceId', { workspaceId });

    if (actualTargetUserId) {
      query.andWhere('request.userId = :actualTargetUserId', { actualTargetUserId });
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
}
