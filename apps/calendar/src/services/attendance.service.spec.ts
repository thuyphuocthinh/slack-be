import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AttendanceService } from './attendance.service';
import { AttendanceLogEntity } from '../entity/attendance_log.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { AttendanceLogType, DailyReconciliationStatus, ShiftLocation } from '../types/calendar.enum';

// ─── Helpers ────────────────────────────────────────────────────────────────

const WS = 'workspace-1';
const USER = 'user-1';
const SHIFT_ID = 'shift-1';

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000);

const makeShift = (overrides: Partial<WorkShiftEntity> = {}): WorkShiftEntity => ({
  id: SHIFT_ID,
  workspaceId: WS,
  userId: USER,
  workDate: new Date().toISOString().slice(0, 10),
  location: ShiftLocation.OFFICE,
  startTime: minutesAgo(60),   // started 1 hour ago
  endTime: minutesFromNow(60), // ends in 1 hour
  status: null,
  approvedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeReconciliation = (
  overrides: Partial<DailyReconciliationEntity> = {},
): DailyReconciliationEntity => ({
  id: 'recon-1',
  workspaceId: WS,
  userId: USER,
  workDate: new Date().toISOString().slice(0, 10),
  workShiftId: SHIFT_ID,
  firstCheckIn: null,
  lastCheckOut: null,
  actualWorkHours: 0,
  standardWorkHours: 0,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  status: DailyReconciliationStatus.NORMAL,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AttendanceService', () => {
  let service: AttendanceService;
  let logRepo: any;
  let reconcRepo: any;
  let shiftRepo: any;
  let policyService: jest.Mocked<Pick<WorkspaceCalendarPolicyService, 'getPolicy'>>;

  beforeEach(async () => {
    logRepo = {
      create: jest.fn().mockImplementation((d) => ({ ...d })),
      save: jest.fn().mockImplementation((e) => Promise.resolve({ id: 'log-1', ...e })),
    };

    reconcRepo = {
      create: jest.fn().mockImplementation((d) => ({ ...d })),
      save: jest.fn().mockImplementation((e) => Promise.resolve({ id: 'recon-1', ...e })),
      findOne: jest.fn().mockResolvedValue(null),
    };

    shiftRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    policyService = {
      getPolicy: jest.fn().mockResolvedValue({ policyData: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: getRepositoryToken(AttendanceLogEntity), useValue: logRepo },
        { provide: getRepositoryToken(DailyReconciliationEntity), useValue: reconcRepo },
        { provide: getRepositoryToken(WorkShiftEntity), useValue: shiftRepo },
        { provide: WorkspaceCalendarPolicyService, useValue: policyService },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── validateLocation — OFFICE ───────────────────────────────────────────

  describe('checkIn — OFFICE location', () => {
    const baseDto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.OFFICE,
      ipAddress: '10.0.0.1',
    };

    it('passes when allowedOfficeIps is empty (no restriction)', async () => {
      policyService.getPolicy.mockResolvedValue({ policyData: {} } as any);
      reconcRepo.findOne.mockResolvedValue(null);
      await expect(service.checkIn(baseDto)).resolves.toBeDefined();
    });

    it('passes when IP is in the allowed list', async () => {
      policyService.getPolicy.mockResolvedValue({
        policyData: { allowedOfficeIps: ['10.0.0.1', '10.0.0.2'] },
      } as any);
      reconcRepo.findOne.mockResolvedValue(null);
      await expect(service.checkIn(baseDto)).resolves.toBeDefined();
    });

    it('throws FORBIDDEN when IP is not in the allowed list', async () => {
      policyService.getPolicy.mockResolvedValue({
        policyData: { allowedOfficeIps: ['10.0.0.99'] },
      } as any);
      await expect(service.checkIn({ ...baseDto, ipAddress: '192.168.1.1' }))
        .rejects.toBeInstanceOf(RpcException);
    });

    it('throws FORBIDDEN with correct statusCode', async () => {
      policyService.getPolicy.mockResolvedValue({
        policyData: { allowedOfficeIps: ['10.0.0.99'] },
      } as any);
      try {
        await service.checkIn({ ...baseDto, ipAddress: '1.2.3.4' });
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        expect((e as RpcException).getError()).toMatchObject({ statusCode: HttpStatus.FORBIDDEN });
      }
    });
  });

  // ─── validateLocation — WFH ──────────────────────────────────────────────

  describe('checkIn — WFH location', () => {
    const baseDto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.WFH,
    };

    it('throws BAD_REQUEST when faceSimilarityScore is missing', async () => {
      await expect(service.checkIn(baseDto)).rejects.toBeInstanceOf(RpcException);
      try {
        await service.checkIn(baseDto);
      } catch (e) {
        expect((e as RpcException).getError()).toMatchObject({ statusCode: HttpStatus.BAD_REQUEST });
      }
    });

    it('throws FORBIDDEN when score is below default threshold (0.6)', async () => {
      await expect(
        service.checkIn({ ...baseDto, faceSimilarityScore: 0.5 }),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('throws FORBIDDEN when score is below custom threshold from policy', async () => {
      policyService.getPolicy.mockResolvedValue({
        policyData: { faceSimilarityThreshold: 0.8 },
      } as any);
      await expect(
        service.checkIn({ ...baseDto, faceSimilarityScore: 0.75 }),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('passes when score meets the threshold', async () => {
      policyService.getPolicy.mockResolvedValue({
        policyData: { faceSimilarityThreshold: 0.8 },
      } as any);
      reconcRepo.findOne.mockResolvedValue(null);
      await expect(
        service.checkIn({ ...baseDto, faceSimilarityScore: 0.85 }),
      ).resolves.toBeDefined();
    });
  });

  // ─── checkIn — reconciliation logic ─────────────────────────────────────

  describe('checkIn — reconciliation creation', () => {
    const dto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.OFFICE,
    };

    it('creates a new DailyReconciliation when none exists', async () => {
      reconcRepo.findOne.mockResolvedValue(null);
      await service.checkIn(dto);
      expect(reconcRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: WS, userId: USER }),
      );
      expect(reconcRepo.save).toHaveBeenCalled();
    });

    it('sets status NORMAL when check-in is within grace period', async () => {
      reconcRepo.findOne.mockResolvedValue(null);
      // shift started 5 min ago — within 15-min grace
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: minutesAgo(5) }));
      await service.checkIn({ ...dto, shiftId: SHIFT_ID });
      expect(reconcRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: DailyReconciliationStatus.NORMAL }),
      );
    });

    it('sets status LATE_EARLY when check-in is beyond grace period', async () => {
      reconcRepo.findOne.mockResolvedValue(null);
      // shift started 30 min ago — beyond 15-min grace
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: minutesAgo(30) }));
      await service.checkIn({ ...dto, shiftId: SHIFT_ID });
      expect(reconcRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: DailyReconciliationStatus.LATE_EARLY }),
      );
    });

    it('updates firstCheckIn when existing record has none', async () => {
      const existing = makeReconciliation({ firstCheckIn: null });
      reconcRepo.findOne.mockResolvedValue(existing);
      await service.checkIn(dto);
      expect(reconcRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ firstCheckIn: expect.any(Date) }),
      );
    });

    it('does not overwrite firstCheckIn when already recorded (idempotent)', async () => {
      const firstIn = minutesAgo(10);
      const existing = makeReconciliation({ firstCheckIn: firstIn });
      reconcRepo.findOne.mockResolvedValue(existing);
      await service.checkIn(dto);
      // save should NOT be called for the existing record with firstCheckIn
      expect(reconcRepo.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ firstCheckIn: expect.not.objectContaining(firstIn) }),
      );
    });
  });

  // ─── checkIn — shiftId overrides location ────────────────────────────────

  describe('checkIn — shiftId resolves location from DB', () => {
    it('uses shift.location instead of dto.location to prevent spoofing', async () => {
      const wfhShift = makeShift({ location: ShiftLocation.WFH });
      shiftRepo.findOne.mockResolvedValue(wfhShift);
      // DTO says OFFICE but shift says WFH → should validate WFH (requires face score)
      await expect(
        service.checkIn({
          workspaceId: WS, userId: USER,
          location: ShiftLocation.OFFICE, // spoofed
          shiftId: SHIFT_ID,
          // no faceSimilarityScore → should fail WFH validation
        }),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('passes when shiftId provided and WFH face score is valid', async () => {
      const wfhShift = makeShift({ location: ShiftLocation.WFH });
      shiftRepo.findOne.mockResolvedValue(wfhShift);
      policyService.getPolicy.mockResolvedValue({ policyData: {} } as any);
      reconcRepo.findOne.mockResolvedValue(null);
      await expect(
        service.checkIn({
          workspaceId: WS, userId: USER,
          location: ShiftLocation.OFFICE, // spoofed but overridden
          shiftId: SHIFT_ID,
          faceSimilarityScore: 0.9,
        }),
      ).resolves.toBeDefined();
    });
  });

  // ─── checkOut ────────────────────────────────────────────────────────────

  describe('checkOut', () => {
    const dto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.OFFICE,
    };

    it('saves a CHECK_OUT attendance log', async () => {
      reconcRepo.findOne.mockResolvedValue(makeReconciliation({ firstCheckIn: minutesAgo(60) }));
      await service.checkOut(dto);
      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ logType: AttendanceLogType.CHECK_OUT }),
      );
    });

    it('sets lastCheckOut and computes actualWorkHours', async () => {
      const firstCheckIn = minutesAgo(120); // 2 hours ago
      reconcRepo.findOne.mockResolvedValue(makeReconciliation({ firstCheckIn }));
      await service.checkOut(dto);
      const saved = reconcRepo.save.mock.calls[0][0] as DailyReconciliationEntity;
      expect(saved.lastCheckOut).toBeInstanceOf(Date);
      expect(saved.actualWorkHours).toBeGreaterThan(1.9);
      expect(saved.actualWorkHours).toBeLessThanOrEqual(2.1);
    });

    it('marks LATE_EARLY when checking out before shift ends (beyond grace)', async () => {
      const earlyShift = makeShift({ endTime: minutesFromNow(60) }); // shift ends in 1hr
      shiftRepo.findOne.mockResolvedValue(earlyShift);
      reconcRepo.findOne.mockResolvedValue(makeReconciliation({ firstCheckIn: minutesAgo(60) }));
      await service.checkOut({ ...dto, shiftId: SHIFT_ID });
      const saved = reconcRepo.save.mock.calls[0][0] as DailyReconciliationEntity;
      expect(saved.status).toBe(DailyReconciliationStatus.LATE_EARLY);
    });

    it('keeps NORMAL when checking out on time (within grace)', async () => {
      const onTimeShift = makeShift({ endTime: minutesFromNow(5) }); // ends in 5 min — within grace
      shiftRepo.findOne.mockResolvedValue(onTimeShift);
      const recon = makeReconciliation({ firstCheckIn: minutesAgo(60), status: DailyReconciliationStatus.NORMAL });
      reconcRepo.findOne.mockResolvedValue(recon);
      await service.checkOut({ ...dto, shiftId: SHIFT_ID });
      const saved = reconcRepo.save.mock.calls[0][0] as DailyReconciliationEntity;
      expect(saved.status).toBe(DailyReconciliationStatus.NORMAL);
    });

    it('returns null reconciliation when no record found', async () => {
      reconcRepo.findOne.mockResolvedValue(null);
      const result = await service.checkOut(dto);
      expect(result.reconciliation).toBeNull();
    });
  });

  // ─── getTodayAttendance ──────────────────────────────────────────────────

  describe('getTodayAttendance', () => {
    it('returns the reconciliation record when it exists', async () => {
      const recon = makeReconciliation();
      reconcRepo.findOne.mockResolvedValue(recon);
      const result = await service.getTodayAttendance({ workspaceId: WS, userId: USER });
      expect(result).toEqual(recon);
    });

    it('returns null when no record exists', async () => {
      reconcRepo.findOne.mockResolvedValue(null);
      const result = await service.getTodayAttendance({ workspaceId: WS, userId: USER });
      expect(result).toBeNull();
    });
  });
});
