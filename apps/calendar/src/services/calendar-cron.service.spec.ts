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
      const recon = makeReconciliation({ firstCheckIn: checkIn, lastCheckOut: null });
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
      const recon = makeReconciliation({ workShiftId: null, firstCheckIn: t('2026-06-21T01:00:00Z'), lastCheckOut: t('2026-06-21T10:00:00Z') });
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

    it('handles multiple shifts and returns correct aggregate counts', async () => {
      shiftRepo.find.mockResolvedValue([
        makeShift({ id: 's1', userId: 'u1' }),
        makeShift({ id: 's2', userId: 'u2' }),
        makeShift({ id: 's3', userId: 'u3' }),
      ]);

      reconcRepo.findOne
        .mockResolvedValueOnce(null) // u1 → ABSENT
        .mockResolvedValueOnce(      // u2 → has check-in, no checkout → auto-close
          makeReconciliation({ userId: 'u2', firstCheckIn: t('2026-06-21T01:00:00Z'), lastCheckOut: null }),
        )
        .mockResolvedValueOnce(      // u3 → full attendance → updated
          makeReconciliation({ userId: 'u3', firstCheckIn: t('2026-06-21T01:00:00Z'), lastCheckOut: t('2026-06-21T10:00:00Z') }),
        );

      const result = await service.runManually(WORK_DATE);

      expect(result).toEqual({
        workDate: WORK_DATE,
        totalShifts: 3,
        absent: 1,
        closed: 1,
        updated: 2,
      });
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
