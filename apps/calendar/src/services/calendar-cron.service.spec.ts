import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CalendarCronService } from './calendar-cron.service';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { DailyReconciliationStatus, ShiftLocation } from '../types/calendar.enum';

// ─── Helpers ────────────────────────────────────────────────────────────────

const WS = 'workspace-1';
const USER_A = 'user-a';
const USER_B = 'user-b';
const WORK_DATE = '2026-06-21';

const t = (iso: string) => new Date(iso);

const makeShift = (overrides: Partial<WorkShiftEntity> = {}): WorkShiftEntity =>
  ({
    id: 'shift-1',
    workspaceId: WS,
    userId: USER_A,
    workDate: WORK_DATE,
    location: ShiftLocation.OFFICE,
    startTime: t('2026-06-21T01:00:00Z'),
    endTime: t('2026-06-21T10:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as WorkShiftEntity;

const makeReconciliation = (
  overrides: Partial<DailyReconciliationEntity> = {},
): DailyReconciliationEntity =>
  ({
    id: 'recon-1',
    workspaceId: WS,
    userId: USER_A,
    workDate: WORK_DATE,
    workShiftId: 'shift-1',
    firstCheckIn: undefined,
    lastCheckOut: undefined,
    actualWorkHours: 0,
    standardWorkHours: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    status: DailyReconciliationStatus.NORMAL,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as DailyReconciliationEntity;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CalendarCronService', () => {
  let service: CalendarCronService;
  let shiftRepo: any;
  let reconcRepo: any;

  beforeEach(async () => {
    shiftRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    reconcRepo = {
      create: jest.fn().mockImplementation((d) => ({ ...d })),
      save: jest.fn().mockImplementation((e) => Promise.resolve({ ...e })),
      findOne: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarCronService,
        { provide: getRepositoryToken(WorkShiftEntity), useValue: shiftRepo },
        { provide: getRepositoryToken(DailyReconciliationEntity), useValue: reconcRepo },
      ],
    }).compile();

    service = module.get<CalendarCronService>(CalendarCronService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── runManually (core reconcile logic via explicit date) ────────────────

  describe('runManually', () => {
    it('returns zero counts when no shifts exist for the date', async () => {
      shiftRepo.find.mockResolvedValue([]);
      const result = await service.runManually(WORK_DATE);
      expect(result).toEqual({ workDate: WORK_DATE, totalShifts: 0, absent: 0, closed: 0, updated: 0 });
      expect(reconcRepo.create).not.toHaveBeenCalled();
      expect(reconcRepo.save).not.toHaveBeenCalled();
    });

    it('creates ABSENT record when shift has no check-in', async () => {
      shiftRepo.find.mockResolvedValue([makeShift()]);
      reconcRepo.findOne.mockResolvedValue(null); // no attendance record

      const result = await service.runManually(WORK_DATE);

      expect(reconcRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: DailyReconciliationStatus.ABSENT }),
      );
      expect(result.absent).toBe(1);
      expect(result.updated).toBe(0);
    });

    it('sets standardWorkHours on ABSENT record from shift duration', async () => {
      const shift = makeShift({
        startTime: t('2026-06-21T01:00:00Z'), // 8h shift
        endTime: t('2026-06-21T09:00:00Z'),
      });
      shiftRepo.find.mockResolvedValue([shift]);
      reconcRepo.findOne.mockResolvedValue(null);

      await service.runManually(WORK_DATE);

      expect(reconcRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ standardWorkHours: 8 }),
      );
    });

    it('auto-closes checkout at shift.endTime when firstCheckIn exists but no checkout', async () => {
      // Use relative times so shiftEnd is always in the past regardless of when tests run
      const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
      const shiftEnd = minutesAgo(30);    // ended 30 min ago
      const checkIn = minutesAgo(150);   // checked in 2.5 hours ago
      const shift = makeShift({ startTime: minutesAgo(180), endTime: shiftEnd });
      const recon = makeReconciliation({ firstCheckIn: checkIn, lastCheckOut: undefined });
      shiftRepo.find.mockResolvedValue([shift]);
      reconcRepo.findOne.mockResolvedValue(recon);

      const result = await service.runManually(WORK_DATE);

      const saved = reconcRepo.save.mock.calls[0][0];
      // shiftEnd is in the past → effectiveOut = shiftEnd
      expect(saved.lastCheckOut).toEqual(shiftEnd);
      // actualWorkHours ≈ (shiftEnd - checkIn) in hours ≈ 2h
      expect(saved.actualWorkHours).toBeGreaterThan(1.9);
      expect(saved.actualWorkHours).toBeLessThan(2.1);
      expect(result.closed).toBe(1);
    });

    it('calculates lateMinutes correctly', async () => {
      const shift = makeShift({ startTime: t('2026-06-21T01:00:00Z') });
      // Checked in 25 minutes late
      const lateCheckIn = t('2026-06-21T01:25:00Z');
      const recon = makeReconciliation({
        firstCheckIn: lateCheckIn,
        lastCheckOut: t('2026-06-21T10:00:00Z'),
      });
      shiftRepo.find.mockResolvedValue([shift]);
      reconcRepo.findOne.mockResolvedValue(recon);

      await service.runManually(WORK_DATE);

      const saved = reconcRepo.save.mock.calls[0][0];
      expect(saved.lateMinutes).toBe(25);
      expect(saved.status).toBe(DailyReconciliationStatus.LATE_EARLY);
    });

    it('sets NORMAL when check-in is within grace period (≤15 min)', async () => {
      const shift = makeShift({ startTime: t('2026-06-21T01:00:00Z') });
      // Checked in 10 minutes late — within grace
      const recon = makeReconciliation({
        firstCheckIn: t('2026-06-21T01:10:00Z'),
        lastCheckOut: t('2026-06-21T10:00:00Z'),
      });
      shiftRepo.find.mockResolvedValue([shift]);
      reconcRepo.findOne.mockResolvedValue(recon);

      await service.runManually(WORK_DATE);

      const saved = reconcRepo.save.mock.calls[0][0];
      expect(saved.lateMinutes).toBe(10);
      expect(saved.status).toBe(DailyReconciliationStatus.NORMAL);
    });

    it('calculates earlyLeaveMinutes and marks LATE_EARLY', async () => {
      const shift = makeShift({ endTime: t('2026-06-21T10:00:00Z') });
      // Left 30 minutes early
      const recon = makeReconciliation({
        firstCheckIn: t('2026-06-21T01:00:00Z'),
        lastCheckOut: t('2026-06-21T09:30:00Z'),
      });
      shiftRepo.find.mockResolvedValue([shift]);
      reconcRepo.findOne.mockResolvedValue(recon);

      await service.runManually(WORK_DATE);

      const saved = reconcRepo.save.mock.calls[0][0];
      expect(saved.earlyLeaveMinutes).toBe(30);
      expect(saved.status).toBe(DailyReconciliationStatus.LATE_EARLY);
    });

    it('sets NORMAL when early leave is within grace period (≤15 min)', async () => {
      const shift = makeShift({ endTime: t('2026-06-21T10:00:00Z') });
      // Left 10 minutes early — within grace
      const recon = makeReconciliation({
        firstCheckIn: t('2026-06-21T01:00:00Z'),
        lastCheckOut: t('2026-06-21T09:50:00Z'),
      });
      shiftRepo.find.mockResolvedValue([shift]);
      reconcRepo.findOne.mockResolvedValue(recon);

      await service.runManually(WORK_DATE);

      const saved = reconcRepo.save.mock.calls[0][0];
      expect(saved.earlyLeaveMinutes).toBe(10);
      expect(saved.status).toBe(DailyReconciliationStatus.NORMAL);
    });

    it('skips records with LEAVE_PAID_APPROVED status', async () => {
      shiftRepo.find.mockResolvedValue([makeShift()]);
      reconcRepo.findOne.mockResolvedValue(
        makeReconciliation({ status: DailyReconciliationStatus.LEAVE_PAID_APPROVED }),
      );

      await service.runManually(WORK_DATE);

      expect(reconcRepo.save).not.toHaveBeenCalled();
    });

    it('skips records with LEAVE_UNPAID_APPROVED status', async () => {
      shiftRepo.find.mockResolvedValue([makeShift()]);
      reconcRepo.findOne.mockResolvedValue(
        makeReconciliation({ status: DailyReconciliationStatus.LEAVE_UNPAID_APPROVED }),
      );

      await service.runManually(WORK_DATE);

      expect(reconcRepo.save).not.toHaveBeenCalled();
    });

    it('links workShiftId on existing reconciliation', async () => {
      const shift = makeShift({ id: 'shift-xyz' });
      const recon = makeReconciliation({ workShiftId: undefined, firstCheckIn: t('2026-06-21T01:00:00Z'), lastCheckOut: t('2026-06-21T10:00:00Z') });
      shiftRepo.find.mockResolvedValue([shift]);
      reconcRepo.findOne.mockResolvedValue(recon);

      await service.runManually(WORK_DATE);

      const saved = reconcRepo.save.mock.calls[0][0];
      expect(saved.workShiftId).toBe('shift-xyz');
    });

    it('continues processing other shifts when one throws', async () => {
      const shiftA = makeShift({ id: 'shift-a', userId: USER_A });
      const shiftB = makeShift({ id: 'shift-b', userId: USER_B });
      shiftRepo.find.mockResolvedValue([shiftA, shiftB]);

      // First shift: findOne throws; second shift: findOne returns null → ABSENT
      reconcRepo.findOne
        .mockRejectedValueOnce(new Error('DB timeout'))
        .mockResolvedValueOnce(null);

      const result = await service.runManually(WORK_DATE);

      // shiftB still processed → 1 absent
      expect(result.absent).toBe(1);
    });

    it('handles multiple shifts for different users and returns correct aggregate counts', async () => {
      shiftRepo.find.mockResolvedValue([
        makeShift({ id: 's1', userId: 'u1' }),
        makeShift({ id: 's2', userId: 'u2' }),
        makeShift({ id: 's3', userId: 'u3' }),
      ]);

      reconcRepo.findOne
        .mockResolvedValueOnce(null) // u1 → ABSENT
        .mockResolvedValueOnce(      // u2 → has check-in, no checkout → auto-close
          makeReconciliation({ userId: 'u2', firstCheckIn: t('2026-06-21T01:00:00Z'), lastCheckOut: undefined }),
        )
        .mockResolvedValueOnce(      // u3 → full attendance → updated
          makeReconciliation({ userId: 'u3', firstCheckIn: t('2026-06-21T01:00:00Z'), lastCheckOut: t('2026-06-21T10:00:00Z') }),
        );

      const result = await service.runManually(WORK_DATE);

      // totalShifts = number of user-day groups (3 users, 3 groups)
      expect(result).toEqual({
        workDate: WORK_DATE,
        totalShifts: 3,
        absent: 1,
        closed: 1,
        updated: 2,
      });
    });

    it('creates only ONE reconciliation record when a user has two shifts on the same day', async () => {
      // Same user (USER_A), same workDate, two non-overlapping shifts: 4h AM + 4h PM
      const shiftAM = makeShift({ id: 'shift-am', startTime: t('2026-06-21T01:00:00Z'), endTime: t('2026-06-21T05:00:00Z') });
      const shiftPM = makeShift({ id: 'shift-pm', startTime: t('2026-06-21T06:00:00Z'), endTime: t('2026-06-21T10:00:00Z') });
      shiftRepo.find.mockResolvedValue([shiftAM, shiftPM]);
      reconcRepo.findOne.mockResolvedValue(null); // no existing record

      const result = await service.runManually(WORK_DATE);

      // Only one group → one findOne call and one create/save call
      expect(reconcRepo.findOne).toHaveBeenCalledTimes(1);
      expect(reconcRepo.create).toHaveBeenCalledTimes(1);
      expect(reconcRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        standardWorkHours: 8,        // 4h AM + 4h PM
        workShiftId: 'shift-am',     // primary = earliest shift
        status: DailyReconciliationStatus.ABSENT,
      }));
      // totalShifts = 1 group (not 2 raw shifts)
      expect(result.totalShifts).toBe(1);
      expect(result.absent).toBe(1);
    });

    it('creates separate reconciliation records for the same user in different workspaces', async () => {
      const WS2 = 'workspace-2';
      const shiftWS1 = makeShift({ id: 'shift-ws1', workspaceId: WS, userId: USER_A });
      const shiftWS2 = makeShift({ id: 'shift-ws2', workspaceId: WS2, userId: USER_A });
      shiftRepo.find.mockResolvedValue([shiftWS1, shiftWS2]);
      reconcRepo.findOne.mockResolvedValue(null); // both → ABSENT

      const result = await service.runManually(WORK_DATE);

      // Two separate groups (different workspaces) → two independent reconciliation records
      expect(reconcRepo.findOne).toHaveBeenCalledTimes(2);
      expect(reconcRepo.create).toHaveBeenCalledTimes(2);
      expect(result.totalShifts).toBe(2);
      expect(result.absent).toBe(2);
    });

    it('uses first shift startTime for lateMinutes and last shift endTime for earlyLeaveMinutes with two shifts', async () => {
      const shiftAM = makeShift({ id: 'shift-am', startTime: t('2026-06-21T01:00:00Z'), endTime: t('2026-06-21T05:00:00Z') });
      const shiftPM = makeShift({ id: 'shift-pm', startTime: t('2026-06-21T06:00:00Z'), endTime: t('2026-06-21T10:00:00Z') });
      const recon = makeReconciliation({
        firstCheckIn: t('2026-06-21T01:25:00Z'),  // 25 min late vs first shift (01:00)
        lastCheckOut: t('2026-06-21T09:30:00Z'),   // 30 min early vs last shift (10:00)
      });
      shiftRepo.find.mockResolvedValue([shiftAM, shiftPM]);
      reconcRepo.findOne.mockResolvedValue(recon);

      await service.runManually(WORK_DATE);

      const saved = reconcRepo.save.mock.calls[0][0];
      expect(saved.lateMinutes).toBe(25);          // vs shiftAM.startTime
      expect(saved.earlyLeaveMinutes).toBe(30);    // vs shiftPM.endTime
      expect(saved.standardWorkHours).toBe(8);     // 4 + 4
      expect(saved.workShiftId).toBe('shift-am');  // primary shift
      expect(saved.status).toBe(DailyReconciliationStatus.LATE_EARLY);
    });
  });

  // ─── dailyReconciliation (auto-triggered, uses today's date) ────────────

  describe('dailyReconciliation', () => {
    it('does not touch DB when no shifts exist for today', async () => {
      shiftRepo.find.mockResolvedValue([]);
      await service.dailyReconciliation();
      expect(reconcRepo.create).not.toHaveBeenCalled();
      expect(reconcRepo.save).not.toHaveBeenCalled();
    });

    it('processes today\'s shifts and creates ABSENT for missing attendance', async () => {
      const today = new Date().toISOString().slice(0, 10);
      shiftRepo.find.mockResolvedValue([makeShift({ workDate: today })]);
      reconcRepo.findOne.mockResolvedValue(null);

      await service.dailyReconciliation();

      expect(reconcRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: DailyReconciliationStatus.ABSENT }),
      );
    });
  });
});
