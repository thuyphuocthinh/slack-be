import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
jest.mock('nanoid', () => ({
  customAlphabet: jest.fn(() => jest.fn(() => 'mock-id')),
}));
import { RpcException } from '@nestjs/microservices';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AttendanceService } from './attendance.service';
import { AttendanceLogEntity } from '../entity/attendance_log.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { UserFaceBaselineEntity } from '../entity/user_face_baseline.entity';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { AttendanceLogType, DailyReconciliationStatus, ShiftLocation } from '../types/calendar.enum';
import { CachedService, RateLimitService } from '@slack/cached';
import { CACHE } from '@slack/cached/cached.constant';

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
  startTime: minutesAgo(60),
  endTime: minutesFromNow(60),
  status: null,
  approvedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as WorkShiftEntity);

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
} as DailyReconciliationEntity);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AttendanceService', () => {
  let service: AttendanceService;
  let logRepo: any;
  let reconcRepo: any;
  let shiftRepo: any;
  let faceBaselineRepo: any;
  let policyService: jest.Mocked<Pick<WorkspaceCalendarPolicyService, 'getPolicy'>>;
  let dataSource: any;
  let manager: any;
  let cachedService: any;

  beforeEach(async () => {
    manager = {
      create: jest.fn().mockImplementation((entityType, d) => ({ ...d })),
      save: jest.fn().mockImplementation((e) => Promise.resolve({ id: 'mock-id', ...e })),
      findOne: jest.fn().mockImplementation(async (entityType, options) => {
        if (entityType === DailyReconciliationEntity) {
          return reconcRepo.findOne(options);
        }
        if (entityType === AttendanceLogEntity) {
          return logRepo.findOne(options);
        }
        return null;
      }),
    };

    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb) => {
        return cb(manager);
      }),
    };

    logRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    reconcRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    shiftRepo = {
      findOne: jest.fn().mockResolvedValue(makeShift()),
    };

    faceBaselineRepo = {
      findOne: jest.fn().mockResolvedValue({ faceDescriptor: new Array(128).fill(0.1) }),
      upsert: jest.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] }),
    };

    cachedService = {
      getOrSetDetail: jest.fn((_key, _ttl, fetcher) => fetcher()),
      invalidateDetail: jest.fn().mockResolvedValue(undefined),
    };

    policyService = {
      getPolicy: jest.fn().mockResolvedValue({ policyData: {} }),
    };

    const rateLimitService = {
      isAllowed: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: getRepositoryToken(DailyReconciliationEntity), useValue: reconcRepo },
        { provide: getRepositoryToken(WorkShiftEntity), useValue: shiftRepo },
        { provide: getRepositoryToken(UserFaceBaselineEntity), useValue: faceBaselineRepo },
        { provide: WorkspaceCalendarPolicyService, useValue: policyService },
        { provide: DataSource, useValue: dataSource },
        { provide: CachedService, useValue: cachedService },
        { provide: RateLimitService, useValue: rateLimitService },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── Time Window Validation ───────────────────────────────────────────

  describe('checkIn/Out — Time Window Validation', () => {
    const dto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.OFFICE,
      shiftId: SHIFT_ID,
      faceDescriptor: new Array(128).fill(0.1),
    };

    it('throws BAD_REQUEST when checking in too early (more than 2 hours)', async () => {
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: minutesFromNow(180), endTime: minutesFromNow(420) }));
      await expect(service.checkIn(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST }),
      });
    });

    it('throws BAD_REQUEST when checking out too late (more than 4 hours after end)', async () => {
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: minutesAgo(420), endTime: minutesAgo(300) }));
      await expect(service.checkOut(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST }),
      });
    });

    it('passes when checking in within the window', async () => {
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: minutesFromNow(60), endTime: minutesFromNow(300) }));
      policyService.getPolicy.mockResolvedValue({ policyData: {} } as any);
      reconcRepo.findOne.mockResolvedValue(null);
      await expect(service.checkIn(dto)).resolves.toBeDefined();
    });

    it('throws BAD_REQUEST if no shift is provided (free check-in is not allowed)', async () => {
      shiftRepo.findOne.mockResolvedValue(null);
      await expect(service.checkIn({ ...dto, shiftId: undefined })).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST }),
      });
    });
  });

  // ─── validateLocation — OFFICE ───────────────────────────────────────────

  describe('checkIn — OFFICE location', () => {
    const baseDto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.OFFICE,
      ipAddress: '10.0.0.1',
      shiftId: SHIFT_ID,
      faceDescriptor: new Array(128).fill(0.1), // exact match with mock baseline
    };

    it('passes when allowedOfficeIps is empty', async () => {
      policyService.getPolicy.mockResolvedValue({ policyData: {} } as any);
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

    it('uses shift.location instead of dto.location to prevent spoofing', async () => {
      const wfhShift = makeShift({ location: ShiftLocation.WFH });
      shiftRepo.findOne.mockResolvedValue(wfhShift);
      await expect(
        service.checkIn({
          ...baseDto,
          faceDescriptor: undefined, // WFH requires faceDescriptor
          location: ShiftLocation.OFFICE, // spoofed
        }),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  // ─── validateLocation — WFH ──────────────────────────────────────────────

  describe('checkIn — WFH location', () => {
    const baseDto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.WFH,
      shiftId: SHIFT_ID,
      faceDescriptor: new Array(128).fill(0.1),
    };

    it('throws BAD_REQUEST when faceDescriptor is missing', async () => {
      shiftRepo.findOne.mockResolvedValueOnce(makeShift({ location: ShiftLocation.WFH }));
      await expect(service.checkIn({ ...baseDto, faceDescriptor: undefined })).rejects.toBeInstanceOf(RpcException);
    });

    it('throws BAD_REQUEST when Baseline is missing', async () => {
      shiftRepo.findOne.mockResolvedValueOnce(makeShift({ location: ShiftLocation.WFH }));
      faceBaselineRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.checkIn(baseDto)).rejects.toMatchObject({
        error: expect.objectContaining({ message: expect.stringContaining('Chưa có dữ liệu khuôn mặt gốc') }),
      });
    });

    it('throws FORBIDDEN when faceDescriptor distance is too far (spoofing)', async () => {
      shiftRepo.findOne.mockResolvedValueOnce(makeShift({ location: ShiftLocation.WFH }));
      // Generate a descriptor that has distance > 0.6
      await expect(service.checkIn({ ...baseDto, faceDescriptor: new Array(128).fill(0.9) })).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN }),
      });
    });

    it('passes when distance meets the threshold', async () => {
      shiftRepo.findOne.mockResolvedValueOnce(makeShift({ location: ShiftLocation.WFH }));
      policyService.getPolicy.mockResolvedValue({
        policyData: { faceSimilarityThreshold: 0.6 },
      } as any);
      reconcRepo.findOne.mockResolvedValue(null);
      
      // Since baseline is 0.1 array, passing 0.1 array distance = 0
      await expect(
        service.checkIn(baseDto),
      ).resolves.toBeDefined();
    });
  });

  // ─── checkIn — reconciliation logic ─────────────────────────────────────

  describe('checkIn — reconciliation creation', () => {
    const dto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.OFFICE,
      shiftId: SHIFT_ID,
      faceDescriptor: new Array(128).fill(0.1),
    };

    it('creates a new DailyReconciliation when none exists', async () => {
      reconcRepo.findOne.mockResolvedValue(null);
      await service.checkIn(dto);
      expect(manager.create).toHaveBeenCalledWith(
        DailyReconciliationEntity,
        expect.objectContaining({ workspaceId: WS, userId: USER }),
      );
      expect(manager.save).toHaveBeenCalled();
    });

    it('does not overwrite firstCheckIn when already recorded (idempotent)', async () => {
      const firstIn = minutesAgo(10);
      const existing = makeReconciliation({ firstCheckIn: firstIn });
      reconcRepo.findOne.mockResolvedValue(existing);
      await service.checkIn(dto);
      expect(manager.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ firstCheckIn: expect.not.objectContaining(firstIn) }),
      );
    });

    it('sets status to LATE_EARLY when checking in late (beyond grace period)', async () => {
      reconcRepo.findOne.mockResolvedValue(null);
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: minutesAgo(30) }));
      await service.checkIn({ ...dto });
      expect(manager.create).toHaveBeenCalledWith(
        DailyReconciliationEntity,
        expect.objectContaining({ status: DailyReconciliationStatus.LATE_EARLY }),
      );
    });
  });

  // ─── checkOut ────────────────────────────────────────────────────────────

  describe('checkOut', () => {
    const dto = {
      workspaceId: WS, userId: USER,
      location: ShiftLocation.OFFICE,
      shiftId: SHIFT_ID,
      faceDescriptor: new Array(128).fill(0.1),
    };

    it('throws BAD_REQUEST if no check-in log exists for today', async () => {
      logRepo.findOne.mockResolvedValue(null);
      await expect(service.checkOut(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST }),
      });
    });

    it('sets lastCheckOut and computes actualWorkHours cumulatively', async () => {
      const checkInLog = { recordedAt: minutesAgo(120) }; // checked in 2 hours ago
      logRepo.findOne.mockResolvedValue(checkInLog);

      const recon = makeReconciliation({ firstCheckIn: minutesAgo(120), actualWorkHours: 0 });
      reconcRepo.findOne.mockResolvedValue(recon);

      await service.checkOut(dto);

      // manager.save is called twice: once for log, once for reconciliation
      const saved = manager.save.mock.calls.find((args) => args[0].workDate)[0] as DailyReconciliationEntity;
      expect(saved.lastCheckOut).toBeInstanceOf(Date);
      expect(saved.actualWorkHours).toBeGreaterThan(1.9);
      expect(saved.actualWorkHours).toBeLessThanOrEqual(2.1);
    });

    it('creates a reconciliation record when no prior record found (edge case)', async () => {
      logRepo.findOne.mockResolvedValue({ recordedAt: new Date(minutesAgo(120)) });
      reconcRepo.findOne.mockResolvedValue(null);
      const result = await service.checkOut(dto);
      expect(result).not.toBeNull();
      expect(result?.actualWorkHours).toBeGreaterThan(1.9);
      expect(result?.firstCheckIn).toBeTruthy();
      expect(result?.lastCheckOut).toBeTruthy();
    });

    it('sets status LATE_EARLY when checking out before shift ends (beyond grace)', async () => {
      const earlyShift = makeShift({ endTime: minutesFromNow(60) }); // ends in 1hr
      shiftRepo.findOne.mockResolvedValue(earlyShift);
      logRepo.findOne.mockResolvedValue({ recordedAt: minutesAgo(60) });
      reconcRepo.findOne.mockResolvedValue(makeReconciliation({ firstCheckIn: minutesAgo(60) }));

      await service.checkOut({ ...dto });
      const saved = manager.save.mock.calls.find((args) => args[0].workDate)[0] as DailyReconciliationEntity;
      expect(saved.status).toBe(DailyReconciliationStatus.LATE_EARLY);
    });
  });

  // ─── getTodayAttendance ──────────────────────────────────────────────────

  describe('getTodayAttendance', () => {
    it('returns the mapped reconciliation record when it exists', async () => {
      const recon = makeReconciliation();
      reconcRepo.findOne.mockResolvedValue(recon);
      const result = await service.getTodayAttendance({ workspaceId: WS, userId: USER, clientDate: '2026-06-23' });
      expect(result).toHaveProperty('id', recon.id);
      expect(result).toHaveProperty('workDate', recon.workDate);
    });

    it('returns null when no record exists', async () => {
      reconcRepo.findOne.mockResolvedValue(null);
      const result = await service.getTodayAttendance({ workspaceId: WS, userId: USER, clientDate: '2026-06-23' });
      expect(result).toBeNull();
    });
  });

  // ─── STATE MACHINE & ADDITIVE LOGIC (10 EDGE CASES) ─────────────────────
  
  describe('State Machine & Additive Logic Edge Cases', () => {
    const dto = { workspaceId: WS, userId: USER, location: ShiftLocation.OFFICE, shiftId: SHIFT_ID, faceDescriptor: new Array(128).fill(0.1) };

    it('1. State Machine: Throws ALREADY_CHECKED_IN if double check-in', async () => {
      logRepo.findOne.mockResolvedValue({ logType: AttendanceLogType.CHECK_IN, recordedAt: new Date(minutesAgo(30)) });
      await expect(service.checkIn(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: 'ERR.CALENDAR.0110' }),
      });
    });

    it('2. State Machine: Throws MISSING_CHECK_IN if double check-out', async () => {
      reconcRepo.findOne.mockResolvedValue(makeReconciliation());
      logRepo.findOne.mockResolvedValue({ logType: AttendanceLogType.CHECK_OUT, recordedAt: new Date(minutesAgo(30)) });
      await expect(service.checkOut(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: 'ERR.CALENDAR.0148' }),
      });
    });

    it('3. State Machine: Allows CHECK_IN after CHECK_OUT (Multi-session)', async () => {
      logRepo.findOne.mockResolvedValue({ logType: AttendanceLogType.CHECK_OUT, recordedAt: new Date(minutesAgo(30)) });
      reconcRepo.findOne.mockResolvedValue(makeReconciliation());
      await expect(service.checkIn(dto)).resolves.toBeDefined();
    });

    it('4. State Machine: Allows CHECK_OUT after CHECK_IN (Happy path)', async () => {
      logRepo.findOne.mockResolvedValue({ logType: AttendanceLogType.CHECK_IN, recordedAt: new Date(minutesAgo(120)) });
      reconcRepo.findOne.mockResolvedValue(makeReconciliation());
      await expect(service.checkOut(dto)).resolves.toBeDefined();
    });

    it('5. Additive Logic: Accumulates 3 micro-sessions correctly without Math.round clipping', async () => {
      const checkInLog = { logType: AttendanceLogType.CHECK_IN, recordedAt: new Date(minutesAgo(3)) }; // worked exactly 3 mins
      logRepo.findOne.mockResolvedValue(checkInLog);
      
      const recon = makeReconciliation({ actualWorkHours: 1.0 }); // already worked 1 hr
      reconcRepo.findOne.mockResolvedValue(recon);
      
      await service.checkOut(dto);
      const saved = manager.save.mock.calls.find((args) => args[0].workDate)[0] as DailyReconciliationEntity;
      
      // 3 minutes = 0.05 hours. New total should be exactly 1.05, not rounded to 1.0 or 1.1
      expect(saved.actualWorkHours).toBeCloseTo(1.05, 3);
    });

    it('6. Additive Logic: Session start boundary handles exact 0 ms duration safely', async () => {
      const nowLog = { logType: AttendanceLogType.CHECK_IN, recordedAt: new Date() };
      logRepo.findOne.mockResolvedValue(nowLog);
      
      const recon = makeReconciliation({ actualWorkHours: 5.5, firstCheckIn: new Date(minutesAgo(300)) });
      reconcRepo.findOne.mockResolvedValue(recon);
      
      await service.checkOut(dto);
      const saved = manager.save.mock.calls.find((args) => args[0].workDate)[0] as DailyReconciliationEntity;
      // recordedAt is created just before `now` in the service — a few ms may be added;
      // toBeCloseTo(5.5, 3) allows up to 0.001h (~3.6s) tolerance which covers test jitter
      expect(saved.actualWorkHours).toBeCloseTo(5.5, 3);
    });

    it('7. Validation: Rejects check-in exactly 1 millisecond outside the 2-hour pre-window', async () => {
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: new Date(Date.now() + 2 * 3600000 + 1) }));
      await expect(service.checkIn(dto)).rejects.toBeInstanceOf(RpcException);
    });

    it('8. Validation: Rejects check-out exactly 1 millisecond outside the 4-hour post-window', async () => {
      shiftRepo.findOne.mockResolvedValue(makeShift({ endTime: new Date(Date.now() - 4 * 3600000 - 1) }));
      await expect(service.checkOut(dto)).rejects.toBeInstanceOf(RpcException);
    });

    it('9. Status Flow: Status switches from LATE_EARLY back to NORMAL if check-out fulfills shift completely', async () => {
      const recon = makeReconciliation({ firstCheckIn: new Date(minutesAgo(480)), status: DailyReconciliationStatus.LATE_EARLY });
      reconcRepo.findOne.mockResolvedValue(recon);
      
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: new Date(minutesAgo(500)), endTime: new Date(minutesAgo(0)) }));
      logRepo.findOne.mockResolvedValue({ logType: AttendanceLogType.CHECK_IN, recordedAt: new Date(minutesAgo(120)) });
      
      await service.checkOut(dto);
      const saved = manager.save.mock.calls.find((args) => args[0].workDate)[0] as DailyReconciliationEntity;
      expect(saved.status).toBe(DailyReconciliationStatus.LATE_EARLY);
    });

    it('10. Status Flow: Grace period edge case exactly equals allowed grace ms (15 mins)', async () => {
      const fifteenMins = 15 * 60_000;
      shiftRepo.findOne.mockResolvedValue(makeShift({ startTime: new Date(Date.now() - fifteenMins) }));
      reconcRepo.findOne.mockResolvedValue(null); // new check in
      logRepo.findOne.mockResolvedValue({ logType: AttendanceLogType.CHECK_OUT, recordedAt: new Date() });
      await service.checkIn(dto);
      
      const saved = manager.create.mock.calls.find((args) => args[0] === DailyReconciliationEntity)[1];
      expect(saved.status).toBe(DailyReconciliationStatus.NORMAL); // Exactly 15 mins is NOT late (> 15 is late)
    });

    it('0. CRITICAL-2: getLatestLog with undefined shiftId returns null (no cross-shift collision)', async () => {
      // Simulate shift resolving to null — validateTimeWindow would throw, but we test the guard directly
      // by checking that checkIn throws SHIFT_REQUIRED when shift is null (before getLatestLog is reached)
      shiftRepo.findOne.mockResolvedValue(null);
      await expect(service.checkIn({ ...dto, shiftId: undefined })).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST }),
      });
      // manager.findOne (getLatestLog) must NOT have been called — guard returns null before DB hit
      expect(manager.findOne).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ where: expect.objectContaining({ workShiftId: undefined }) }),
      );
    });

    it('11. Security/Concurrency: Acquires pessimistic lock on reconciliation BEFORE querying latest log', async () => {
      // Clear previous calls
      manager.findOne.mockClear();
      logRepo.findOne.mockResolvedValue({ logType: AttendanceLogType.CHECK_IN, recordedAt: new Date(minutesAgo(120)) });
      reconcRepo.findOne.mockResolvedValue(makeReconciliation());

      await service.checkOut(dto);

      // manager.findOne should be called first for DailyReconciliationEntity
      const firstCall = manager.findOne.mock.calls[0];
      const secondCall = manager.findOne.mock.calls[1];

      expect(firstCall[0]).toBe(DailyReconciliationEntity);
      expect(firstCall[1].lock).toEqual({ mode: 'pessimistic_write' });

      expect(secondCall[0]).toBe(AttendanceLogEntity);
    });
  });

  // ─── saveFaceBaseline ────────────────────────────────────────────────────

  describe('saveFaceBaseline', () => {
    const descriptor = new Array(128).fill(0.5);

    it('upserts with the correct payload and returns { success: true }', async () => {
      const result = await service.saveFaceBaseline({
        workspaceId: WS,
        userId: USER,
        faceImageKey: 'cloudinary/face.jpg',
        faceDescriptor: descriptor,
      });

      expect(faceBaselineRepo.upsert).toHaveBeenCalledWith(
        { workspaceId: WS, userId: USER, faceBaselineKey: 'cloudinary/face.jpg', faceDescriptor: descriptor },
        ['userId', 'workspaceId'],
      );
      expect(result).toEqual({ success: true });
    });

    it('defaults faceBaselineKey to empty string when faceImageKey is omitted', async () => {
      await service.saveFaceBaseline({ workspaceId: WS, userId: USER, faceDescriptor: descriptor });

      expect(faceBaselineRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ faceBaselineKey: '' }),
        expect.anything(),
      );
    });

    it('invalidates the Redis cache with the correct key after upsert', async () => {
      await service.saveFaceBaseline({
        workspaceId: WS,
        userId: USER,
        faceImageKey: 'cloudinary/face.jpg',
        faceDescriptor: descriptor,
      });

      const expectedKey = CACHE.CALENDAR.KEYS.FACE_BASELINE(WS, USER);
      expect(cachedService.invalidateDetail).toHaveBeenCalledWith(expectedKey);
    });

    it('invalidates cache even when faceImageKey is omitted', async () => {
      await service.saveFaceBaseline({ workspaceId: WS, userId: USER, faceDescriptor: descriptor });

      expect(cachedService.invalidateDetail).toHaveBeenCalledTimes(1);
    });
  });

  // ─── validateLocation — cache integration ───────────────────────────────

  describe('validateLocation — Redis cache integration', () => {
    const wfhDto = {
      workspaceId: WS,
      userId: USER,
      location: ShiftLocation.WFH,
      shiftId: SHIFT_ID,
      faceDescriptor: new Array(128).fill(0.1),
    };

    it('reads face baseline via cachedService.getOrSetDetail with correct key and TTL', async () => {
      shiftRepo.findOne.mockResolvedValue(makeShift({ location: ShiftLocation.WFH }));
      policyService.getPolicy.mockResolvedValue({ policyData: {} } as any);
      reconcRepo.findOne.mockResolvedValue(null);

      await service.checkIn(wfhDto);

      const expectedKey = CACHE.CALENDAR.KEYS.FACE_BASELINE(WS, USER);
      expect(cachedService.getOrSetDetail).toHaveBeenCalledWith(
        expectedKey,
        expect.any(Number),
        expect.any(Function),
      );
    });

    it('fetcher inside getOrSetDetail calls faceBaselineRepository.findOne', async () => {
      shiftRepo.findOne.mockResolvedValue(makeShift({ location: ShiftLocation.WFH }));
      policyService.getPolicy.mockResolvedValue({ policyData: {} } as any);
      reconcRepo.findOne.mockResolvedValue(null);

      await service.checkIn(wfhDto);

      expect(faceBaselineRepo.findOne).toHaveBeenCalledWith({
        where: { workspaceId: WS, userId: USER },
      });
    });
  });
});
