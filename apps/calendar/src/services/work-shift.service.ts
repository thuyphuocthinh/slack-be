import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { BulkRegisterWorkShiftDto, GetWorkShiftsDto, UpdateWorkShiftDto, DeleteWorkShiftDto } from '../dto/calendar-request.dto';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { CalendarCommonService } from './calendar-common.service';
import { WorkShiftResponseDto } from '../dto/calendar-response.dto';
import { plainToInstance } from 'class-transformer';
import { CALENDAR_ERROR, AUTH_ERROR } from '@slack/constants';
import { ShiftStatus } from '../types/calendar.enum';
import { isUtcString } from '@slack/common/utils/time.util';
import { WorkShiftValidationPayload } from '../types/calendar.type';

@Injectable()
export class WorkShiftService {
  private readonly logger = new Logger(WorkShiftService.name);

  constructor(
    @InjectRepository(WorkShiftEntity)
    private readonly workShiftRepository: Repository<WorkShiftEntity>,
    private readonly policyService: WorkspaceCalendarPolicyService,
    private readonly calendarCommonService: CalendarCommonService,
  ) {}

  async bulkRegisterShifts(dto: BulkRegisterWorkShiftDto) {
    const { workspaceId, requestorId, userId, shifts, location } = dto;

    try {
      // 1. Authorize requestor
      const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
      this.calendarCommonService.assertSelfOrPrivileged(requestorId, userId, requestor.role);

      // 2. Fetch target member for policy validation (reuse requestor if same user)
      const targetMember = requestorId === userId ? requestor : await this.calendarCommonService.fetchMember(workspaceId, userId);

      // 3. Build shift records and validate UTC times
      const shiftsToInsert: Partial<WorkShiftEntity>[] = [];
      const validationPayload: WorkShiftValidationPayload[] = [];

      for (const shift of shifts) {
        if (!isUtcString(shift.startTime) || !isUtcString(shift.endTime)) {
          throw new RpcException({
            statusCode: HttpStatus.BAD_REQUEST,
            ...CALENDAR_ERROR.INVALID_TIME_UTC,
          });
        }

        const startTime = new Date(shift.startTime as unknown as string);
        const endTime = new Date(shift.endTime as unknown as string);

        shiftsToInsert.push({ workspaceId, userId, workDate: shift.workDate, startTime, endTime, location, status: ShiftStatus.APPROVED });
        validationPayload.push({ workDate: shift.workDate, startTime, endTime, location });
      }

      // 4. Validate against policy
      await this.policyService.validateShifts(workspaceId, userId, targetMember.employmentType, targetMember.role, validationPayload);

      // 5. Upsert and return
      await this.workShiftRepository.upsert(shiftsToInsert, {
        conflictPaths: ['userId', 'workspaceId', 'workDate'],
        skipUpdateIfNoValuesChanged: true,
      });

      const upsertedShifts = await this.workShiftRepository.find({
        where: { workspaceId, userId, workDate: In(shifts.map(s => s.workDate)) },
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
    const { workspaceId, requestorId, startDate, endDate, userId } = dto;

    try {
      const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);

      // Members can only view their own shifts
      if (!this.calendarCommonService.isPrivileged(requestor.role) && userId && userId !== requestorId) {
        throw new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...AUTH_ERROR.FORBIDDEN,
        });
      }

      // Privileged users can filter by any userId or view all; members always see only themselves
      const effectiveUserId = this.calendarCommonService.isPrivileged(requestor.role) ? userId : requestorId;

      const shifts = await this.workShiftRepository.find({
        where: {
          workspaceId,
          workDate: Between(startDate, endDate),
          ...(effectiveUserId && { userId: effectiveUserId }),
        },
        order: { workDate: 'ASC', startTime: 'ASC' },
      });

      return plainToInstance(WorkShiftResponseDto, shifts);
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('Error fetching work shifts:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.FETCH_SHIFTS_FAILED,
      });
    }
  }

  async updateWorkShift(dto: UpdateWorkShiftDto) {
    const { id, workspaceId, requestorId, userId, ...updateData } = dto;

    try {
      // 1. Validate UTC times upfront
      if (updateData.startTime && !isUtcString(updateData.startTime)) {
        throw new RpcException({ statusCode: HttpStatus.BAD_REQUEST, ...CALENDAR_ERROR.INVALID_TIME_UTC });
      }
      if (updateData.endTime && !isUtcString(updateData.endTime)) {
        throw new RpcException({ statusCode: HttpStatus.BAD_REQUEST, ...CALENDAR_ERROR.INVALID_TIME_UTC });
      }

      // 2. Find shift
      const shift = await this.workShiftRepository.findOne({ where: { id, workspaceId, userId } });
      if (!shift) {
        throw new RpcException({ statusCode: HttpStatus.NOT_FOUND, ...CALENDAR_ERROR.SHIFT_NOT_FOUND });
      }

      // 3. Early return if no changes
      if (Object.keys(updateData).length === 0) {
        return plainToInstance(WorkShiftResponseDto, shift);
      }

      // 4. Authorize requestor
      const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
      this.calendarCommonService.assertSelfOrPrivileged(requestorId, userId, requestor.role);

      // 5. Fetch target member for policy validation (reuse requestor if same user)
      const targetMember = requestorId === userId ? requestor : await this.calendarCommonService.fetchMember(workspaceId, userId);

      // 6. Validate updated shift against policy
      const newLocation = updateData.location ?? shift.location;
      const newStartTime = updateData.startTime ? new Date(updateData.startTime) : shift.startTime;
      const newEndTime = updateData.endTime ? new Date(updateData.endTime) : shift.endTime;

      await this.policyService.validateShifts(workspaceId, userId, targetMember.employmentType, targetMember.role, [{
        id: shift.id,
        workDate: shift.workDate,
        startTime: newStartTime,
        endTime: newEndTime,
        location: newLocation,
      }]);

      // 7. Apply update and return
      await this.workShiftRepository.update({ id, workspaceId, userId }, updateData);

      const updatedShift = await this.workShiftRepository.findOne({ where: { id } });
      return plainToInstance(WorkShiftResponseDto, updatedShift);
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('Error updating work shift:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.UPDATE_SHIFT_FAILED,
      });
    }
  }

  async deleteWorkShift(dto: DeleteWorkShiftDto) {
    const { id, workspaceId, requestorId, userId } = dto;

    try {
      // 1. Find shift
      const shift = await this.workShiftRepository.findOne({ where: { id, workspaceId, userId } });
      if (!shift) {
        throw new RpcException({ statusCode: HttpStatus.NOT_FOUND, ...CALENDAR_ERROR.SHIFT_NOT_FOUND });
      }

      // 2. Authorize requestor
      const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
      this.calendarCommonService.assertSelfOrPrivileged(requestorId, userId, requestor.role);

      // 3. Check lock deadline (admin/owner bypass via their role)
      await this.policyService.checkLockDeadline(workspaceId, requestor.role, [shift.workDate]);

      // 4. Delete
      await this.workShiftRepository.delete({ id, workspaceId, userId });

      return 'Work shift deleted successfully';
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('Error deleting work shift:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.DELETE_SHIFT_FAILED,
      });
    }
  }
}
