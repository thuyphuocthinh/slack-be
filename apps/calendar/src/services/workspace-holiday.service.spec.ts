import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceHolidayService } from './workspace-holiday.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceHolidayEntity } from '../entity/workspace_holiday.entity';
import { CalendarCommonService } from './calendar-common.service';
import { CachedService } from '@slack/cached/cached.service';
import { CACHE } from '@slack/cached/cached.constant';
import { RpcException } from '@nestjs/microservices';
import { CALENDAR_ERROR } from '@slack/constants';
import * as Holidays from 'date-holidays';

jest.mock('nanoid', () => ({
  customAlphabet: jest.fn(() => jest.fn(() => 'mock-id')),
}));

describe('WorkspaceHolidayService', () => {
  let service: WorkspaceHolidayService;
  let repository: any;
  let commonService: any;
  let cachedService: any;

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    commonService = {
      fetchMember: jest.fn(),
      assertPrivileged: jest.fn(),
    };

    cachedService = {
      getOrSetList: jest.fn((options) => options.fetcher()),
      invalidateList: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceHolidayService,
        {
          provide: getRepositoryToken(WorkspaceHolidayEntity),
          useValue: repository,
        },
        {
          provide: CalendarCommonService,
          useValue: commonService,
        },
        {
          provide: CachedService,
          useValue: cachedService,
        },
      ],
    }).compile();

    service = module.get<WorkspaceHolidayService>(WorkspaceHolidayService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getHolidays', () => {
    it('should return holidays from repository if cache misses', async () => {
      const mockHolidays = [{ id: '1', date: '2026-01-01', isRecurringYearly: true }];
      repository.find.mockResolvedValue(mockHolidays);

      const result = await service.getHolidays('workspace-1', 2026);
      expect(result).toEqual(mockHolidays);
      expect(repository.find).toHaveBeenCalled();
      expect(cachedService.getOrSetList).toHaveBeenCalledWith(expect.objectContaining({
        trackerKey: CACHE.CALENDAR.TRACKERS.HOLIDAYS_VERSION('workspace-1'),
      }));
    });
  });

  describe('createHoliday', () => {
    const dto = {
      workspaceId: 'workspace-1',
      requestorId: 'user-1',
      name: 'New Year',
      date: '2026-01-01',
      isRecurringYearly: true,
    };

    it('should create a holiday successfully', async () => {
      commonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
      repository.create.mockReturnValue(dto);
      repository.save.mockResolvedValue({ id: '1', ...dto });

      const result = await service.createHoliday(dto);

      expect(result.id).toEqual('1');
      expect(repository.save).toHaveBeenCalled();
      expect(cachedService.invalidateList).toHaveBeenCalledWith(CACHE.CALENDAR.TRACKERS.HOLIDAYS_VERSION(dto.workspaceId));
    });

    it('should throw HOLIDAY_ALREADY_EXISTS on duplicate date', async () => {
      commonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
      repository.create.mockReturnValue(dto);
      repository.save.mockRejectedValue({ code: '23505' });

      await expect(service.createHoliday(dto)).rejects.toMatchObject({
        error: { code: CALENDAR_ERROR.HOLIDAY_ALREADY_EXISTS.code }
      });
    });
  });

  describe('updateHoliday', () => {
    const dto = {
      id: '1',
      workspaceId: 'workspace-1',
      requestorId: 'user-1',
      name: 'Updated Name',
    };

    it('should update holiday successfully', async () => {
      commonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
      const existing = { id: '1', workspaceId: 'workspace-1', name: 'Old', date: '2026-01-01' };
      repository.findOne.mockResolvedValue(existing);
      repository.save.mockResolvedValue({ ...existing, name: 'Updated Name' });

      const result = await service.updateHoliday(dto);
      expect(result.name).toEqual('Updated Name');
      expect(cachedService.invalidateList).toHaveBeenCalled();
    });

    it('should throw HOLIDAY_NOT_FOUND if not found', async () => {
      commonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
      repository.findOne.mockResolvedValue(null);

      await expect(service.updateHoliday(dto)).rejects.toMatchObject({
        error: { code: CALENDAR_ERROR.HOLIDAY_NOT_FOUND.code }
      });
    });
  });

  describe('deleteHoliday', () => {
    const dto = {
      id: '1',
      workspaceId: 'workspace-1',
      requestorId: 'user-1',
    };

    it('should delete holiday successfully', async () => {
      commonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
      repository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deleteHoliday(dto);
      expect(result.success).toBe(true);
      expect(cachedService.invalidateList).toHaveBeenCalled();
    });

    it('should throw HOLIDAY_NOT_FOUND if affected is 0', async () => {
      commonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
      repository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.deleteHoliday(dto)).rejects.toMatchObject({
        error: { code: CALENDAR_ERROR.HOLIDAY_NOT_FOUND.code }
      });
    });
  });

  describe('autoFillHolidays', () => {
    const dto = {
      workspaceId: 'workspace-1',
      requestorId: 'user-1',
      year: 2026,
      countryCode: 'VN',
    };

    it('should auto-fill holidays successfully', async () => {
      commonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
      repository.findOne.mockResolvedValue(null); // Nothing exists yet
      repository.create.mockImplementation((obj) => obj);
      repository.save.mockResolvedValue({});

      // getHolidays will be called at the end
      repository.find.mockResolvedValue([{ id: 'h1' }]);

      const result = await service.autoFillHolidays(dto);
      expect(result.length).toBe(1);
      expect(repository.save).toHaveBeenCalled();
      expect(cachedService.invalidateList).toHaveBeenCalled();
    });

    it('should throw UNSUPPORTED_COUNTRY_HOLIDAY_AUTO_FILL if invalid country', async () => {
      commonService.fetchMember.mockResolvedValue({ role: 'ADMIN' });
      const invalidDto = { ...dto, countryCode: 'XX_INVALID' };

      await expect(service.autoFillHolidays(invalidDto)).rejects.toMatchObject({
        error: { code: CALENDAR_ERROR.UNSUPPORTED_COUNTRY_HOLIDAY_AUTO_FILL.code }
      });
    });
  });

  describe('checkIfDatesAreHolidays', () => {
    it('should correctly identify non-recurring and recurring holidays', async () => {
      // Mock getHolidays response
      const mockHolidays = [
        { id: '1', date: '2026-05-01', isRecurringYearly: false },
        { id: '2', date: '2024-01-01', isRecurringYearly: true }, // New year
      ];
      repository.find.mockResolvedValue(mockHolidays);

      const dates = ['2026-05-01', '2026-01-01', '2026-10-10'];
      const result = await service.checkIfDatesAreHolidays('workspace-1', dates);

      expect(result['2026-05-01']).toBe(true); // Exact match
      expect(result['2026-01-01']).toBe(true); // Recurring match
      expect(result['2026-10-10']).toBe(false); // No match
    });
  });
});
