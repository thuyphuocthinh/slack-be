// Prevent worker thread from spawning during tests — resolve immediately with a mock buffer
jest.mock('worker_threads', () => {
  const mockBuffer = Buffer.from('mock-excel-content');
  return {
    Worker: jest.fn().mockImplementation(() => ({
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'message') setImmediate(() => handler(mockBuffer));
      }),
    })),
    isMainThread: true,
    workerData: null,
    parentPort: null,
  };
});

// Mock ESM-only transitive deps (nanoid@5) before any module resolution
jest.mock('@slack/cached', () => ({
  CachedService: class CachedService {},
  TTL: { SHORT: 300, MEDIUM: 3600 },
  CACHE: {
    CALENDAR: {
      KEYS: {
        WORKSPACE_MEMBER_STATS: (ws: string, m: string) => `stats:${ws}:${m}`,
        EXPORT_JOB: (id: string) => `export:job_${id}`,
      },
    },
  },
}));

jest.mock('@slack/queue', () => ({
  QueueService: class QueueService {},
  EQueueName: { CALENDAR_QUEUE: 'calendar_queue' },
  EJobName: { CALENDAR_EXPORT_EXCEL: 'calendar_export_excel' },
}));

jest.mock('./calendar-common.service', () => ({
  CalendarCommonService: class CalendarCommonService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AttendanceStatisticService } from './attendance-statistic.service';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { DailyReconciliationStatus } from '../types/calendar.enum';
import { CalendarCommonService } from './calendar-common.service';
import { CachedService } from '@slack/cached';
import { QueueService } from '@slack/queue';

describe('AttendanceStatisticService', () => {
  let service: AttendanceStatisticService;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
  };

  const mockReconcRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  const mockCalendarCommonService = {
    fetchMember: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
    assertPrivileged: jest.fn(),
    assertSelfOrPrivileged: jest.fn(),
    getWorkspaceMembers: jest.fn().mockResolvedValue([]),
  };

  const mockCachedService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };

  const mockQueueService = {
    addJob: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceStatisticService,
        {
          provide: getRepositoryToken(DailyReconciliationEntity),
          useValue: mockReconcRepo,
        },
        {
          provide: CalendarCommonService,
          useValue: mockCalendarCommonService,
        },
        {
          provide: CachedService,
          useValue: mockCachedService,
        },
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
      ],
    }).compile();

    service = module.get<AttendanceStatisticService>(AttendanceStatisticService);

    jest.clearAllMocks();
    mockCalendarCommonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
    mockCachedService.get.mockResolvedValue(null);
    mockCachedService.set.mockResolvedValue(undefined);
    mockQueueService.addJob.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPersonalSummary', () => {
    it('should aggregate and map personal summary correctly', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({
        totalWorkHours: '42.5',
        lateDays: '2',
        absentDays: '0',
        leaveDays: '1',
      });

      const result = await service.getPersonalSummary('ws1', 'user1', 'user1', '2026-06-01', '2026-06-07');

      expect(mockReconcRepo.createQueryBuilder).toHaveBeenCalledWith('recon');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('recon.workspaceId = :workspaceId', { workspaceId: 'ws1' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.userId = :userId', { userId: 'user1' });

      expect(result).toEqual({
        totalWorkHours: 42.5,
        lateDays: 2,
        absentDays: 0,
        leaveDays: 1,
      });
    });

    it('should handle null values correctly', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({
        totalWorkHours: null,
        lateDays: null,
        absentDays: null,
        leaveDays: null,
      });

      const result = await service.getPersonalSummary('ws1', 'user1', 'user1', '2026-06-01', '2026-06-07');

      expect(result).toEqual({
        totalWorkHours: 0,
        lateDays: 0,
        absentDays: 0,
        leaveDays: 0,
      });
    });
  });

  describe('getWorkspaceMembers', () => {
    it('should return cache hit without hitting DB', async () => {
      const cached = [{ userId: 'user1', totalWorkHours: 160, lateDays: 0, absentDays: 0, leaveDays: 0 }];
      mockCachedService.get.mockResolvedValue(cached);

      const result = await service.getWorkspaceMembers('ws1', 'admin1', '2026-06');

      expect(result).toEqual(cached);
      expect(mockReconcRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockCachedService.set).not.toHaveBeenCalled();
    });

    it('should aggregate members for a 30-day month (June) and cache result', async () => {
      mockCachedService.get.mockResolvedValue(null);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { userId: 'user1', totalWorkHours: '160', lateDays: '1', absentDays: '0', leaveDays: '0' },
      ]);
      mockCalendarCommonService.getWorkspaceMembers.mockResolvedValue([{ userId: 'user1' }]);

      const result = await service.getWorkspaceMembers('ws1', 'admin1', '2026-06');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate >= :startDate', { startDate: '2026-06-01' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate <= :endDate', { endDate: '2026-06-30' });
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('recon.userId');
      expect(mockCachedService.set).toHaveBeenCalled();

      expect(result).toEqual([
        { userId: 'user1', totalWorkHours: 160, lateDays: 1, absentDays: 0, leaveDays: 0 },
      ]);
    });

    it('should compute correct end date for February (non-leap year)', async () => {
      mockCachedService.get.mockResolvedValue(null);
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockCalendarCommonService.getWorkspaceMembers.mockResolvedValue([]);

      await service.getWorkspaceMembers('ws1', 'admin1', '2026-02');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate >= :startDate', { startDate: '2026-02-01' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate <= :endDate', { endDate: '2026-02-28' });
    });

    it('should compute correct end date for January (31 days)', async () => {
      mockCachedService.get.mockResolvedValue(null);
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockCalendarCommonService.getWorkspaceMembers.mockResolvedValue([]);

      await service.getWorkspaceMembers('ws1', 'admin1', '2026-01');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate >= :startDate', { startDate: '2026-01-01' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate <= :endDate', { endDate: '2026-01-31' });
    });

    it('should fill zeros for members with no reconciliation records', async () => {
      mockCachedService.get.mockResolvedValue(null);
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockCalendarCommonService.getWorkspaceMembers.mockResolvedValue([{ userId: 'user99' }]);

      const result = await service.getWorkspaceMembers('ws1', 'admin1', '2026-06');

      expect(result).toEqual([{ userId: 'user99', totalWorkHours: 0, lateDays: 0, absentDays: 0, leaveDays: 0 }]);
    });
  });

  describe('getPersonalChartData', () => {
    it('should return mapped chart data ordered by date', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { date: '2026-06-01', workHours: '8', status: DailyReconciliationStatus.NORMAL },
        { date: '2026-06-02', workHours: '7.5', status: DailyReconciliationStatus.LATE_EARLY },
      ]);

      const result = await service.getPersonalChartData('ws1', 'user1', 'user1', '2026-06-01', '2026-06-07');

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('recon.workDate', 'ASC');
      expect(result).toEqual([
        { date: '2026-06-01', workHours: 8, status: DailyReconciliationStatus.NORMAL },
        { date: '2026-06-02', workHours: 7.5, status: DailyReconciliationStatus.LATE_EARLY },
      ]);
    });
  });

  describe('exportWorkspaceExcel', () => {
    it('should fetch data on main thread then delegate generation to worker thread', async () => {
      // getWorkspaceMembers (cache miss path)
      mockQueryBuilder.getRawMany.mockResolvedValueOnce([
        { userId: 'user1', totalWorkHours: '160', lateDays: '1', absentDays: '0', leaveDays: '0' },
      ]);
      mockCalendarCommonService.getWorkspaceMembers.mockResolvedValue([{ userId: 'user1' }]);
      // raw logs for detail sheet
      mockQueryBuilder.getRawMany.mockResolvedValueOnce([
        { userId: 'user1', workDate: '2026-06-05', status: DailyReconciliationStatus.LATE_EARLY },
      ]);

      const { Worker } = require('worker_threads');
      const buffer = await service.exportWorkspaceExcel('ws1', 'admin1', '2026-06');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      // Worker was spawned once with the pre-fetched data
      expect(Worker).toHaveBeenCalledTimes(1);
      const workerCtorArg = Worker.mock.calls[0][1];
      expect(workerCtorArg.workerData).toMatchObject({
        membersData: expect.any(Array),
        rawLogs: expect.any(Array),
      });
    });
  });

  describe('enqueueExport', () => {
    it('should set PENDING in cache and enqueue a job, returning a UUID jobId', async () => {
      const result = await service.enqueueExport('ws1', 'admin1', '2026-06');

      expect(result).toHaveProperty('jobId');
      expect(typeof result.jobId).toBe('string');
      expect(result.jobId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      expect(mockCachedService.set).toHaveBeenCalledWith(
        expect.stringContaining('export:job_'),
        { status: 'PENDING' },
        expect.any(Number),
      );

      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ jobId: result.jobId, workspaceId: 'ws1', requestorId: 'admin1', month: '2026-06' }),
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it('should throw when requestor is not privileged', async () => {
      mockCalendarCommonService.assertPrivileged.mockImplementation(() => {
        throw new Error('Forbidden');
      });

      await expect(service.enqueueExport('ws1', 'member1', '2026-06')).rejects.toThrow('Forbidden');
      expect(mockQueueService.addJob).not.toHaveBeenCalled();
    });
  });

  describe('getExportStatus', () => {
    it('should return PENDING status when job is in cache', async () => {
      mockCachedService.get.mockResolvedValue({ status: 'PENDING' });

      const result = await service.getExportStatus('some-job-id');

      expect(result).toEqual({ status: 'PENDING' });
    });

    it('should return DONE status with base64 data when job completed', async () => {
      mockCachedService.get.mockResolvedValue({ status: 'DONE', data: 'base64encodeddata==' });

      const result = await service.getExportStatus('some-job-id');

      expect(result).toEqual({ status: 'DONE', data: 'base64encodeddata==' });
    });

    it('should return FAILED with error message when job failed', async () => {
      mockCachedService.get.mockResolvedValue({ status: 'FAILED', error: 'DB timeout' });

      const result = await service.getExportStatus('some-job-id');

      expect(result).toEqual({ status: 'FAILED', error: 'DB timeout' });
    });

    it('should return FAILED with "Job not found or expired" when cache key missing', async () => {
      mockCachedService.get.mockResolvedValue(null);

      const result = await service.getExportStatus('expired-job-id');

      expect(result).toEqual({ status: 'FAILED', error: 'Job not found or expired' });
    });
  });
});
