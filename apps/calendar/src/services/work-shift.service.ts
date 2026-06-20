import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { RpcException, ClientProxy } from '@nestjs/microservices';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { BulkRegisterWorkShiftDto, GetWorkShiftsDto, UpdateWorkShiftDto, DeleteWorkShiftDto } from '../dto/calendar-request.dto';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { WorkShiftResponseDto } from '../dto/calendar-response.dto';
import { plainToInstance } from 'class-transformer';
import { WORKSPACE_MESSAGE_PATTERNS, NAME_SERVICE_TCP, CALENDAR_ERROR } from '@slack/constants';
import { ShiftStatus } from '../types/calendar.enum';
import { firstValueFrom } from 'rxjs';
import { isUtcString } from '@slack/common/utils/time.util';
import { WorkShiftValidationPayload } from '../types/calendar.type';

@Injectable()
export class WorkShiftService {
  private readonly logger = new Logger(WorkShiftService.name);

  constructor(
    @InjectRepository(WorkShiftEntity)
    private readonly workShiftRepository: Repository<WorkShiftEntity>,
    private readonly policyService: WorkspaceCalendarPolicyService,
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
  ) { }

  async bulkRegisterShifts(dto: BulkRegisterWorkShiftDto) {
    const { workspaceId, userId, shifts, location } = dto;

    try {
      // 1. Validate membership and get employmentType
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

      // 2. Format shifts and fetch user info
      const shiftsToInsert: Partial<WorkShiftEntity>[] = [];
      const validationPayload: WorkShiftValidationPayload[] = [];

      for (const shift of shifts) {
        // Extra safeguard: Ensure it's strictly UTC using common util
        if (!isUtcString(shift.startTime) || !isUtcString(shift.endTime)) {
          throw new RpcException({
            statusCode: HttpStatus.BAD_REQUEST,
            ...CALENDAR_ERROR.INVALID_TIME_UTC,
          });
        }

        const startObj = new Date(shift.startTime as unknown as string);
        const endObj = new Date(shift.endTime as unknown as string);

        shiftsToInsert.push({
          workspaceId,
          userId,
          workDate: shift.workDate,
          startTime: startObj,
          endTime: endObj,
          location,
          status: ShiftStatus.APPROVED, // Auto-approve or PENDING depending on policy
        });

        validationPayload.push({
          workDate: shift.workDate,
          startTime: startObj,
          endTime: endObj,
          location,
        });
      }

      // 3. Delegate Validation to Policy Service
      await this.policyService.validateShifts(
        workspaceId,
        userId,
        member.employmentType,
        member.role,
        validationPayload
      );

      // Upsert to handle updates if they re-register on the same day
      await this.workShiftRepository.upsert(shiftsToInsert, {
        conflictPaths: ['userId', 'workspaceId', 'workDate'],
        skipUpdateIfNoValuesChanged: true,
      });

      const upsertedShifts = await this.workShiftRepository.find({
        where: {
          workspaceId,
          userId,
          workDate: In(shifts.map(s => s.workDate)),
        },
      });

      return plainToInstance(WorkShiftResponseDto, upsertedShifts);
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('Error bulk registering shifts:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.BULK_REGISTER_FAILED,
      });
    }
  }

  async getWorkShifts(dto: GetWorkShiftsDto) {
    const { workspaceId, startDate, endDate, userId } = dto;

    try {
      const whereCondition: any = {
        workspaceId,
        workDate: Between(startDate, endDate),
      };

      if (userId) {
        whereCondition.userId = userId;
      }

      const shifts = await this.workShiftRepository.find({
        where: whereCondition,
        order: {
          workDate: 'ASC',
          startTime: 'ASC',
        },
      });

      return plainToInstance(WorkShiftResponseDto, shifts);
    } catch (error) {
      this.logger.error(`Error fetching work shifts:`, error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.FETCH_SHIFTS_FAILED,
      });
    }
  }

  async updateWorkShift(dto: UpdateWorkShiftDto) {
    const { id, workspaceId, userId, ...updateData } = dto;

    try {
      if (updateData.startTime && !isUtcString(updateData.startTime)) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.INVALID_TIME_UTC,
        });
      }

      if (updateData.endTime && !isUtcString(updateData.endTime)) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.INVALID_TIME_UTC,
        });
      }

      const shift = await this.workShiftRepository.findOne({ where: { id, workspaceId, userId } });
      if (!shift) {
        throw new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.SHIFT_NOT_FOUND,
        });
      }

      if (Object.keys(updateData).length === 0) {
        return plainToInstance(WorkShiftResponseDto, shift);
      }

      // 2. Fetch Member for Business Rules
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

      const newLocation = updateData.location || shift.location;
      const newStartTime = updateData.startTime ? new Date(updateData.startTime) : shift.startTime;
      const newEndTime = updateData.endTime ? new Date(updateData.endTime) : shift.endTime;

      // 3. Delegate Validation to Policy Service
      await this.policyService.validateShifts(
        workspaceId,
        userId,
        member.employmentType,
        member.role,
        [{
          id: shift.id,
          workDate: shift.workDate,
          startTime: newStartTime,
          endTime: newEndTime,
          location: newLocation
        }]
      );

      const updateResult = await this.workShiftRepository.update(
        { id, workspaceId, userId },
        updateData
      );

      if (updateResult.affected === 0) {
        throw new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.SHIFT_NOT_FOUND,
        });
      }

      const updatedShift = await this.workShiftRepository.findOne({ where: { id } });
      return plainToInstance(WorkShiftResponseDto, updatedShift);
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`Error updating work shift:`, error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.UPDATE_SHIFT_FAILED,
      });
    }
  }

  async deleteWorkShift(dto: DeleteWorkShiftDto) {
    const { id, workspaceId, userId } = dto;

    try {
      const shift = await this.workShiftRepository.findOne({ where: { id, workspaceId, userId } });
      if (!shift) {
        throw new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.SHIFT_NOT_FOUND,
        });
      }

      // Check lock deadline before deleting
      const member = await firstValueFrom(
        this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, { workspaceId, userId })
      );
      if (!member) {
        throw new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.NOT_WORKSPACE_MEMBER,
        });
      }

      await this.policyService.checkLockDeadline(workspaceId, member.role, [shift.workDate]);

      const deleteResult = await this.workShiftRepository.delete({ id, workspaceId, userId });

      if (deleteResult.affected === 0) {
        throw new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.SHIFT_NOT_FOUND,
        });
      }

      return 'Work shift deleted successfully';
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`Error deleting work shift:`, error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.DELETE_SHIFT_FAILED,
      });
    }
  }
}
