import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { AttendanceLogEntity } from '../entity/attendance_log.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { CheckInDto, CheckOutDto, GetTodayAttendanceDto } from '../dto/calendar-request.dto';
import { AttendanceLogType, DailyReconciliationStatus, ShiftLocation } from '../types/calendar.enum';
import { CALENDAR_ERROR } from '@slack/constants';

const DEFAULT_FACE_SIMILARITY_THRESHOLD = 0.6;
const LATE_GRACE_MINUTES = 15;

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectRepository(AttendanceLogEntity)
    private readonly logRepository: Repository<AttendanceLogEntity>,
    @InjectRepository(DailyReconciliationEntity)
    private readonly reconciliationRepository: Repository<DailyReconciliationEntity>,
    @InjectRepository(WorkShiftEntity)
    private readonly shiftRepository: Repository<WorkShiftEntity>,
    private readonly policyService: WorkspaceCalendarPolicyService,
  ) {}

  private todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async validateLocation(
    workspaceId: string,
    location: ShiftLocation,
    ipAddress?: string,
    faceSimilarityScore?: number,
  ) {
    const policy = await this.policyService.getPolicy(workspaceId);
    const policyData = policy?.policyData as Record<string, any> | undefined;

    if (location === ShiftLocation.OFFICE) {
      const allowedIps: string[] = policyData?.allowedOfficeIps ?? [];
      if (allowedIps.length > 0 && ipAddress && !allowedIps.includes(ipAddress)) {
        throw new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.CALENDAR_LOCKED,
          message: 'IP không thuộc mạng văn phòng. Vui lòng kết nối WiFi văn phòng để chấm công.',
        });
      }
    }

    if (location === ShiftLocation.WFH) {
      const threshold: number = policyData?.faceSimilarityThreshold ?? DEFAULT_FACE_SIMILARITY_THRESHOLD;
      if (faceSimilarityScore === undefined || faceSimilarityScore === null) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.CALENDAR_LOCKED,
          message: 'WFH yêu cầu xác thực khuôn mặt. Vui lòng bật camera.',
        });
      }
      if (faceSimilarityScore < threshold) {
        throw new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.CALENDAR_LOCKED,
          message: `Độ khớp khuôn mặt quá thấp (${Math.round(faceSimilarityScore * 100)}%). Yêu cầu tối thiểu ${Math.round(threshold * 100)}%.`,
        });
      }
    }
  }

  private async resolveShift(shiftId: string | undefined, userId: string, workspaceId: string) {
    if (!shiftId) return null;
    return this.shiftRepository.findOne({ where: { id: shiftId, userId, workspaceId } });
  }

  async checkIn(dto: CheckInDto) {
    const { workspaceId, userId, location, shiftId, ipAddress, faceImageKey, faceSimilarityScore } = dto;

    const shift = await this.resolveShift(shiftId, userId, workspaceId);
    // Use location from DB shift (prevents client spoofing); fallback to dto.location
    const resolvedLocation: ShiftLocation = shift ? shift.location : location;

    await this.validateLocation(workspaceId, resolvedLocation, ipAddress, faceSimilarityScore);

    const now = new Date();
    const workDate = this.todayUtc();

    // Determine late status
    let reconciliationStatus = DailyReconciliationStatus.NORMAL;
    if (shift?.startTime) {
      const graceMs = LATE_GRACE_MINUTES * 60_000;
      if (now.getTime() > new Date(shift.startTime).getTime() + graceMs) {
        reconciliationStatus = DailyReconciliationStatus.LATE_EARLY;
      }
    }

    try {
      const log = this.logRepository.create({
        workspaceId,
        userId,
        logType: AttendanceLogType.CHECK_IN,
        recordedAt: now,
        ipAddress,
        faceImageKey,
        faceSimilarityScore,
      });
      await this.logRepository.save(log);

      const existing = await this.reconciliationRepository.findOne({
        where: { workspaceId, userId, workDate },
      });

      if (existing) {
        if (!existing.firstCheckIn) {
          existing.firstCheckIn = now;
          existing.status = reconciliationStatus;
          await this.reconciliationRepository.save(existing);
        }
        return { log, reconciliation: existing };
      }

      const reconciliation = this.reconciliationRepository.create({
        workspaceId,
        userId,
        workDate,
        firstCheckIn: now,
        status: reconciliationStatus,
      });
      await this.reconciliationRepository.save(reconciliation);

      return { log, reconciliation };
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('checkIn error:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.BULK_REGISTER_FAILED,
        message: 'Chấm công thất bại. Vui lòng thử lại.',
      });
    }
  }

  async checkOut(dto: CheckOutDto) {
    const { workspaceId, userId, location, shiftId, ipAddress, faceImageKey, faceSimilarityScore } = dto;

    const shift = await this.resolveShift(shiftId, userId, workspaceId);
    const resolvedLocation: ShiftLocation = shift ? shift.location : location;

    await this.validateLocation(workspaceId, resolvedLocation, ipAddress, faceSimilarityScore);

    const now = new Date();
    const workDate = this.todayUtc();

    try {
      const log = this.logRepository.create({
        workspaceId,
        userId,
        logType: AttendanceLogType.CHECK_OUT,
        recordedAt: now,
        ipAddress,
        faceImageKey,
        faceSimilarityScore,
      });
      await this.logRepository.save(log);

      const reconciliation = await this.reconciliationRepository.findOne({
        where: { workspaceId, userId, workDate },
      });

      if (reconciliation) {
        reconciliation.lastCheckOut = now;
        if (reconciliation.firstCheckIn) {
          const diffMs = now.getTime() - reconciliation.firstCheckIn.getTime();
          reconciliation.actualWorkHours = Math.round((diffMs / 3_600_000) * 100) / 100;
        }
        // Mark early leave if checking out before shift ends (with grace period)
        if (shift?.endTime) {
          const graceMs = LATE_GRACE_MINUTES * 60_000;
          if (now.getTime() < new Date(shift.endTime).getTime() - graceMs) {
            reconciliation.status = DailyReconciliationStatus.LATE_EARLY;
          }
        }
        await this.reconciliationRepository.save(reconciliation);
        return { log, reconciliation };
      }

      return { log, reconciliation: null };
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('checkOut error:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.BULK_REGISTER_FAILED,
        message: 'Chấm công thất bại. Vui lòng thử lại.',
      });
    }
  }

  async getTodayAttendance(dto: GetTodayAttendanceDto) {
    const { workspaceId, userId } = dto;
    const workDate = this.todayUtc();
    const reconciliation = await this.reconciliationRepository.findOne({
      where: { workspaceId, userId, workDate },
    });
    return reconciliation ?? null;
  }
}
