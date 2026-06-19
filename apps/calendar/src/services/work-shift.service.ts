import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RpcException, ClientProxy } from '@nestjs/microservices';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { BulkRegisterWorkShiftDto } from '../dto/calendar-request.dto';
import { WORKSPACE_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { ShiftStatus } from '../types/calendar.enum';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WorkShiftService {
  private readonly logger = new Logger(WorkShiftService.name);

  constructor(
    @InjectRepository(WorkShiftEntity)
    private readonly workShiftRepository: Repository<WorkShiftEntity>,
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
  ) {}

  async bulkRegisterShifts(dto: BulkRegisterWorkShiftDto) {
    const { workspaceId, userId, dates, startTime, endTime, location } = dto;

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

      // 2. Validate Business Rules (e.g., WFH limits, max working hours for PARTTIME/FULLTIME)
      // For now, simple implementation: parse start and end time
      // Future logic: check deadline, overlap, etc.

      const shiftsToInsert: Partial<WorkShiftEntity>[] = [];

      for (const dateStr of dates) {
        const [startHours, startMinutes] = startTime.split(':');
        const [endHours, endMinutes] = endTime.split(':');

        const shiftStart = new Date(`${dateStr}T${startHours}:${startMinutes}:00Z`);
        const shiftEnd = new Date(`${dateStr}T${endHours}:${endMinutes}:00Z`);

        // Example business validation: FULLTIME requires at least 8 hours?
        // Let's rely on employmentType later if needed

        shiftsToInsert.push({
          workspaceId,
          userId,
          workDate: dateStr,
          startTime: shiftStart,
          endTime: shiftEnd,
          location,
          status: ShiftStatus.APPROVED, // Auto-approve or PENDING depending on policy
        });
      }

      // Upsert to handle updates if they re-register on the same day
      await this.workShiftRepository.upsert(shiftsToInsert, {
        conflictPaths: ['userId', 'workspaceId', 'workDate'],
        skipUpdateIfNoValuesChanged: true,
      });

      return {
        success: true,
        message: `Successfully registered ${shiftsToInsert.length} shifts.`,
      };
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('Error bulk registering shifts:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to bulk register shifts',
      });
    }
  }
}
