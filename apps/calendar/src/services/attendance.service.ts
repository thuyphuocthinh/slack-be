import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { AttendanceLogEntity } from '../entity/attendance_log.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { UserFaceBaselineEntity } from '../entity/user_face_baseline.entity';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { CheckInDto, CheckOutDto, GetTodayAttendanceDto, SaveFaceBaselineDto } from '../dto/calendar-request.dto';
import { AttendanceLogType, DailyReconciliationStatus, ShiftLocation } from '../types/calendar.enum';
import { CALENDAR_ERROR } from '@slack/constants';
import { todayUtc } from '@slack/common/utils/time.util';
import { CachedService, TTL, CACHE } from '@slack/cached';

const DEFAULT_FACE_SIMILARITY_THRESHOLD = 0.6;

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectRepository(DailyReconciliationEntity)
    private readonly reconciliationRepository: Repository<DailyReconciliationEntity>,
    @InjectRepository(WorkShiftEntity)
    private readonly shiftRepository: Repository<WorkShiftEntity>,
    @InjectRepository(UserFaceBaselineEntity)
    private readonly faceBaselineRepository: Repository<UserFaceBaselineEntity>,
    private readonly policyService: WorkspaceCalendarPolicyService,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
  ) { }

  private async resolveShift(shiftId: string | undefined, userId: string, workspaceId: string) {
    if (!shiftId) return null;
    return this.shiftRepository.findOne({ where: { id: shiftId, userId, workspaceId } });
  }

  /**
   * Validates location/face auth and returns the workspace grace period in minutes.
   * Throws RpcException on any validation failure.
   */
  private async validateLocation(
    workspaceId: string,
    userId: string,
    location: ShiftLocation,
    ipAddress?: string,
    faceDescriptor?: number[],
  ): Promise<{ graceMinutes: number; similarityScore: number }> {
    const policy = await this.policyService.getPolicy(workspaceId);
    const policyData = policy?.policyData as Record<string, any> | undefined;

    if (location === ShiftLocation.OFFICE) {
      const allowedIps: string[] = policyData?.allowedOfficeIps ?? [];
      if (allowedIps.length > 0 && ipAddress && !allowedIps.includes(ipAddress)) {
        throw new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.IP_NOT_IN_OFFICE_NETWORK,
        });
      }
    }

    const threshold: number = policyData?.faceSimilarityThreshold ?? DEFAULT_FACE_SIMILARITY_THRESHOLD;

    if (!faceDescriptor || faceDescriptor.length === 0) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.FACE_AUTH_REQUIRED,
        message: 'Cần xác thực khuôn mặt để chấm công. Vui lòng bật camera và thử lại.',
      });
    }

    const faceBaseline = await this.cachedService.getOrSetDetail<UserFaceBaselineEntity | null>(
      CACHE.CALENDAR.KEYS.FACE_BASELINE(workspaceId, userId),
      TTL.MEDIUM,
      () => this.faceBaselineRepository.findOne({ where: { workspaceId, userId } }),
    );

    if (!faceBaseline || !faceBaseline.faceDescriptor) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.WFH_REQUIRES_FACE_AUTH,
        message: 'Chưa có dữ liệu khuôn mặt gốc (Baseline). Vui lòng yêu cầu HR cập nhật.',
      });
    }

    const distance = this.euclideanDistance(faceDescriptor, faceBaseline.faceDescriptor);

    if (distance > threshold) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...CALENDAR_ERROR.FACE_NOT_MATCH,
        message: `Khuôn mặt không khớp. Khoảng cách: ${distance.toFixed(2)} (Cho phép <= ${threshold}).`,
      });
    }

    const similarityScore = Math.max(0, 1.0 - distance);
    return { graceMinutes: policyData?.gracePeriodMinutes ?? 15, similarityScore };
  }

  private euclideanDistance(descriptor1: number[], descriptor2: number[]): number {
    if (descriptor1.length !== descriptor2.length) return 1.0;
    let sum = 0;
    for (let i = 0; i < descriptor1.length; i++) {
      const diff = descriptor1[i] - descriptor2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private validateTimeWindow(shift: WorkShiftEntity | null, now: Date) {
    if (!shift) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.SHIFT_REQUIRED_FOR_ATTENDANCE,
      });
    }

    // Allow check-in/out between: [startTime - 2 hours] and [endTime + 4 hours]
    const startWindow = new Date(shift.startTime).getTime() - 2 * 3_600_000;
    const endWindow = new Date(shift.endTime).getTime() + 4 * 3_600_000;
    const currentTime = now.getTime();

    if (currentTime < startWindow || currentTime > endWindow) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...CALENDAR_ERROR.NOT_IN_SHIFT_TIME,
      });
    }
  }

  private async getLatestLog(manager: EntityManager, workspaceId: string, userId: string, shiftId: string | undefined): Promise<AttendanceLogEntity | null> {
    return manager.findOne(AttendanceLogEntity, {
      where: { workspaceId, userId, workShiftId: shiftId },
      order: { recordedAt: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private mapToResponse(reconciliation: DailyReconciliationEntity | null) {
    if (!reconciliation) return null;
    return {
      id: reconciliation.id,
      workDate: reconciliation.workDate,
      firstCheckIn: reconciliation.firstCheckIn ? reconciliation.firstCheckIn.toISOString() : null,
      lastCheckOut: reconciliation.lastCheckOut ? reconciliation.lastCheckOut.toISOString() : null,
      actualWorkHours: reconciliation.actualWorkHours,
      status: reconciliation.status,
    };
  }

  async checkIn(dto: CheckInDto) {
    const { workspaceId, userId, location, shiftId, ipAddress, faceImageKey, faceDescriptor } = dto;
    const now = new Date();

    const shift = await this.resolveShift(shiftId, userId, workspaceId);
    this.validateTimeWindow(shift, now);

    const resolvedLocation: ShiftLocation = shift ? shift.location : location;
    const { graceMinutes, similarityScore } = await this.validateLocation(workspaceId, userId, resolvedLocation, ipAddress, faceDescriptor);
    const graceMs = graceMinutes * 60_000;

    const workDate = shift?.workDate ?? todayUtc();

    let reconciliationStatus = DailyReconciliationStatus.NORMAL;
    if (shift?.startTime) {
      if (now.getTime() > new Date(shift.startTime).getTime() + graceMs) {
        reconciliationStatus = DailyReconciliationStatus.LATE_EARLY;
      }
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        let reconciliation = await manager.findOne(DailyReconciliationEntity, {
          where: { workspaceId, userId, workDate },
          lock: { mode: 'pessimistic_write' },
        });

        const latestLog = await this.getLatestLog(manager, workspaceId, userId, shift?.id);
        if (latestLog && latestLog.logType === AttendanceLogType.CHECK_IN) {
          throw new RpcException({
            statusCode: HttpStatus.BAD_REQUEST,
            ...CALENDAR_ERROR.ALREADY_CHECKED_IN,
          });
        }

        const log = manager.create(AttendanceLogEntity, {
          workspaceId,
          userId,
          workShiftId: shift?.id,
          logType: AttendanceLogType.CHECK_IN,
          recordedAt: now,
          ipAddress,
          faceImageKey,
          faceSimilarityScore: similarityScore,
        });
        await manager.save(log);

        if (reconciliation) {
          if (!reconciliation.firstCheckIn) {
            reconciliation.firstCheckIn = now;
            reconciliation.status = reconciliationStatus;
            await manager.save(reconciliation);
          }
        } else {
          reconciliation = manager.create(DailyReconciliationEntity, {
            workspaceId,
            userId,
            workDate,
            workShiftId: shift?.id,
            firstCheckIn: now,
            status: reconciliationStatus,
          });
          await manager.save(reconciliation);
        }

        return this.mapToResponse(reconciliation);
      });
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('checkIn error:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.ATTENDANCE_FAILED,
      });
    }
  }

  async checkOut(dto: CheckOutDto) {
    const { workspaceId, userId, location, shiftId, ipAddress, faceImageKey, faceDescriptor } = dto;
    const now = new Date();

    const shift = await this.resolveShift(shiftId, userId, workspaceId);
    this.validateTimeWindow(shift, now);

    const resolvedLocation: ShiftLocation = shift ? shift.location : location;
    const { graceMinutes, similarityScore } = await this.validateLocation(workspaceId, userId, resolvedLocation, ipAddress, faceDescriptor);
    const graceMs = graceMinutes * 60_000;

    const workDate = shift?.workDate ?? todayUtc();

    try {
      return await this.dataSource.transaction(async (manager) => {
        let reconciliation = await manager.findOne(DailyReconciliationEntity, {
          where: { workspaceId, userId, workDate },
          lock: { mode: 'pessimistic_write' },
        });

        const latestLog = await this.getLatestLog(manager, workspaceId, userId, shift?.id);
        if (!latestLog || latestLog.logType === AttendanceLogType.CHECK_OUT) {
          throw new RpcException({
            statusCode: HttpStatus.BAD_REQUEST,
            ...CALENDAR_ERROR.MISSING_CHECK_IN,
          });
        }

        const log = manager.create(AttendanceLogEntity, {
          workspaceId,
          userId,
          workShiftId: shift?.id,
          logType: AttendanceLogType.CHECK_OUT,
          recordedAt: now,
          ipAddress,
          faceImageKey,
          faceSimilarityScore: similarityScore,
        });
        await manager.save(log);

        if (reconciliation) {
          if (latestLog.recordedAt < now) {
            const sessionStart = latestLog.recordedAt;
            const diffMs = now.getTime() - sessionStart.getTime();
            reconciliation.actualWorkHours = reconciliation.actualWorkHours + diffMs / 3_600_000;
          }

          reconciliation.lastCheckOut = now;

          reconciliation.status = DailyReconciliationStatus.NORMAL;
          if (shift?.startTime && reconciliation.firstCheckIn) {
            if (reconciliation.firstCheckIn.getTime() > new Date(shift.startTime).getTime() + graceMs) {
              reconciliation.status = DailyReconciliationStatus.LATE_EARLY;
            }
          }
          if (shift?.endTime) {
            if (now.getTime() < new Date(shift.endTime).getTime() - graceMs) {
              reconciliation.status = DailyReconciliationStatus.LATE_EARLY;
            }
          }

          await manager.save(reconciliation);
          return this.mapToResponse(reconciliation);
        }

        // Edge case: check-in log exists but reconciliation record is missing.
        const sessionStart = latestLog.recordedAt;
        const additionalHours = (now.getTime() - sessionStart.getTime()) / 3_600_000;

        let status = DailyReconciliationStatus.NORMAL;
        if (shift?.startTime) {
          if (sessionStart.getTime() > new Date(shift.startTime).getTime() + graceMs) {
            status = DailyReconciliationStatus.LATE_EARLY;
          }
        }
        if (shift?.endTime) {
          if (now.getTime() < new Date(shift.endTime).getTime() - graceMs) {
            status = DailyReconciliationStatus.LATE_EARLY;
          }
        }

        reconciliation = manager.create(DailyReconciliationEntity, {
          workspaceId,
          userId,
          workDate,
          workShiftId: shift?.id,
          firstCheckIn: sessionStart,
          lastCheckOut: now,
          actualWorkHours: additionalHours,
          status,
        });
        await manager.save(reconciliation);
        return this.mapToResponse(reconciliation);
      });
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('checkOut error:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.ATTENDANCE_FAILED,
      });
    }
  }

  async getTodayAttendance(dto: GetTodayAttendanceDto) {
    const { workspaceId, userId, clientDate } = dto;
    const workDate = clientDate;
    const reconciliation = await this.reconciliationRepository.findOne({
      where: { workspaceId, userId, workDate },
    });
    return this.mapToResponse(reconciliation);
  }

  async saveFaceBaseline(dto: SaveFaceBaselineDto) {
    const { workspaceId, userId, faceImageKey, faceDescriptor } = dto;

    await this.faceBaselineRepository.upsert(
      { workspaceId, userId, faceBaselineKey: faceImageKey ?? '', faceDescriptor },
      ['userId', 'workspaceId'],
    );

    await this.cachedService.invalidateDetail(
      CACHE.CALENDAR.KEYS.FACE_BASELINE(workspaceId, userId),
    );

    return { success: true };
  }
}