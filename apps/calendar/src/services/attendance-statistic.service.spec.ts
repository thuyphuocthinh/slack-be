import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AttendanceStatisticService } from './attendance-statistic.service';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { DailyReconciliationStatus } from '../types/calendar.enum';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceStatisticService,
        {
          provide: getRepositoryToken(DailyReconciliationEntity),
          useValue: mockReconcRepo,
        },
      ],
    }).compile();

    service = module.get<AttendanceStatisticService>(AttendanceStatisticService);
    
    // Clear all mocks
    jest.clearAllMocks();
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

      const result = await service.getPersonalSummary('ws1', 'user1', '2026-06-01', '2026-06-07');

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

      const result = await service.getPersonalSummary('ws1', 'user1', '2026-06-01', '2026-06-07');

      expect(result).toEqual({
        totalWorkHours: 0,
        lateDays: 0,
        absentDays: 0,
        leaveDays: 0,
      });
    });
  });

  describe('getWorkspaceMembers', () => {
    it('should aggregate and map workspace members correctly for a 30-day month (June)', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        {
          userId: 'user1',
          totalWorkHours: '160',
          lateDays: '1',
          absentDays: '0',
          leaveDays: '0',
        },
      ]);

      const result = await service.getWorkspaceMembers('ws1', '2026-06');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate >= :startDate', { startDate: '2026-06-01' });
      // June has 30 days
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate <= :endDate', { endDate: '2026-06-30' });
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('recon.userId');

      expect(result).toEqual([
        {
          userId: 'user1',
          totalWorkHours: 160,
          lateDays: 1,
          absentDays: 0,
          leaveDays: 0,
        },
      ]);
    });

    it('should aggregate and map workspace members correctly for a 28-day month (February non-leap year)', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getWorkspaceMembers('ws1', '2026-02');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate >= :startDate', { startDate: '2026-02-01' });
      // February 2026 has 28 days
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate <= :endDate', { endDate: '2026-02-28' });
      expect(result).toEqual([]);
    });

    it('should aggregate and map workspace members correctly for a 31-day month (January)', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getWorkspaceMembers('ws1', '2026-01');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate >= :startDate', { startDate: '2026-01-01' });
      // January 2026 has 31 days
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('recon.workDate <= :endDate', { endDate: '2026-01-31' });
      expect(result).toEqual([]);
    });
  });

  describe('getPersonalChartData', () => {
    it('should return mapped chart data', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { date: '2026-06-01', workHours: '8', status: DailyReconciliationStatus.NORMAL },
        { date: '2026-06-02', workHours: '7.5', status: DailyReconciliationStatus.LATE_EARLY },
      ]);

      const result = await service.getPersonalChartData('ws1', 'user1', '2026-06-01', '2026-06-07');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('recon.workDate', 'ASC');
      expect(result).toEqual([
        { date: '2026-06-01', workHours: 8, status: DailyReconciliationStatus.NORMAL },
        { date: '2026-06-02', workHours: 7.5, status: DailyReconciliationStatus.LATE_EARLY },
      ]);
    });
  });

  describe('exportWorkspaceExcel', () => {
    it('should generate an excel buffer with 2 sheets and correct structure', async () => {
      // Mock workspace members
      mockQueryBuilder.getRawMany.mockResolvedValueOnce([
        { userId: 'user1', totalWorkHours: '160', lateDays: '1', absentDays: '0', leaveDays: '0' },
      ]);
      // Mock raw logs for detail sheet
      mockQueryBuilder.getRawMany.mockResolvedValueOnce([
        { userId: 'user1', workDate: '2026-06-05', status: DailyReconciliationStatus.LATE_EARLY },
        { userId: 'user1', workDate: '2026-06-06', status: DailyReconciliationStatus.ABSENT },
        { userId: 'user1', workDate: '2026-06-07', status: DailyReconciliationStatus.LEAVE_PAID_APPROVED },
        { userId: 'user1', workDate: '2026-06-08', status: DailyReconciliationStatus.NORMAL },
      ]);

      const buffer = await service.exportWorkspaceExcel('ws1', '2026-06');

      expect(buffer).toBeDefined();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    }, 15000);
  });
});
