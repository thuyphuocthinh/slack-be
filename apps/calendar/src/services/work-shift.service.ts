import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { RpcException, ClientProxy } from '@nestjs/microservices';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { BulkRegisterWorkShiftDto, GetWorkShiftsDto } from '../dto/calendar-request.dto';
import { WorkShiftResponseDto } from '../dto/calendar-response.dto';
import { plainToInstance } from 'class-transformer';
import { WORKSPACE_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { ShiftStatus } from '../types/calendar.enum';
import { firstValueFrom } from 'rxjs';
import { isUtcString } from '@slack/common';

@Injectable()
export class WorkShiftService {
  private readonly logger = new Logger(WorkShiftService.name);

  constructor(
    @InjectRepository(WorkShiftEntity)
    private readonly workShiftRepository: Repository<WorkShiftEntity>,
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
          message: 'User is not a member of this workspace',
        });
      }

      // 2. Validate Business Rules
      const shiftsToInsert: Partial<WorkShiftEntity>[] = [];

      for (const shift of shifts) {
        // Extra safeguard: Ensure it's strictly UTC using common util
        if (!isUtcString(shift.startTime) || !isUtcString(shift.endTime)) {
          throw new RpcException({
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Strict UTC Validation Failed: startTime and endTime must be valid UTC strings ending with Z',
          });
        }
        shiftsToInsert.push({
          workspaceId,
          userId,
          workDate: shift.workDate,
          startTime: shift.startTime as unknown as Date,
          endTime: shift.endTime as unknown as Date,
          location,
          status: ShiftStatus.APPROVED, // Auto-approve or PENDING depending on policy
        });
      }

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
        message: 'Failed to bulk register shifts',
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
        message: 'Failed to fetch work shifts',
      });
    }
  }
}
