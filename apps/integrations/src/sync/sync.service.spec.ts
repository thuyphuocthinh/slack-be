import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

jest.mock('uuid', () => ({ v4: () => '123456789' }));
jest.mock('@slack/common', () => ({}));
jest.mock('@slack/cached', () => ({}));
jest.mock('../auth/auth.service');
import { SyncService } from './sync.service';
import { GoogleCalendarProvider } from './providers/google-calendar.provider';
import { AuthService } from '../auth/auth.service';

jest.mock('../auth/auth.service');

import { CalendarSyncMappingEntity } from './entity/calendar-sync-mapping.entity';
import { CalendarSyncStatus, IntegrationProvider } from '@slack/constants';
import { ISyncCalendarShiftJobData, IDeleteCalendarShiftJobData } from '@slack/queue';

describe('SyncService', () => {
  let service: SyncService;

  const mockMappingRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
  };

  const mockGoogleCalendarProvider = {
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
  };

  const mockAuthService = {
    getConnectionByProvider: jest.fn(),
    getValidAccessToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: getRepositoryToken(CalendarSyncMappingEntity), useValue: mockMappingRepo },
        { provide: GoogleCalendarProvider, useValue: mockGoogleCalendarProvider },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    jest.clearAllMocks();

    // Setup transaction mock to execute the callback with the repo acting as the manager
    mockMappingRepo.manager.transaction.mockImplementation(async (cb) => {
      return cb(mockMappingRepo);
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('syncShiftToGoogleCalendar', () => {
    const jobData: ISyncCalendarShiftJobData = {
      userId: 'user-1',
      shiftId: 'shift-1',
      workspaceId: 'ws-1',
      startDate: '2023-01-01T08:00:00Z',
      endDate: '2023-01-01T17:00:00Z',
      location: 'Office',
    };

    it('should skip if user is not connected', async () => {
      mockAuthService.getConnectionByProvider.mockResolvedValueOnce(null);
      await service.syncShiftToGoogleCalendar(jobData);
      expect(mockMappingRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('should create new event if mapping does not exist', async () => {
      mockAuthService.getConnectionByProvider.mockResolvedValueOnce({ id: 'conn-1' });
      mockMappingRepo.findOne.mockResolvedValueOnce(null); // Not found
      const newMapping = { id: 'uuid-1', externalEventId: null, syncStatus: null, lastSyncedAt: null, lastError: null };
      mockMappingRepo.create.mockReturnValueOnce(newMapping);
      mockMappingRepo.save.mockResolvedValue(newMapping);
      mockAuthService.getValidAccessToken.mockResolvedValueOnce('token-1');
      mockGoogleCalendarProvider.createEvent.mockResolvedValueOnce('uuid1v2');

      await service.syncShiftToGoogleCalendar(jobData);

      expect(mockGoogleCalendarProvider.createEvent).toHaveBeenCalledWith(
        'token-1',
        'uuid1', // mapping.id without hyphens
        expect.any(Object),
      );
      expect(mockMappingRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        syncStatus: CalendarSyncStatus.SUCCESS,
        externalEventId: 'uuid1',
      }));
    });

    it('should update existing event if mapping exists with externalEventId', async () => {
      mockAuthService.getConnectionByProvider.mockResolvedValueOnce({ id: 'conn-1' });
      const existingMapping = { id: 'uuid-1', externalEventId: 'uuid1', syncStatus: CalendarSyncStatus.SUCCESS };
      mockMappingRepo.findOne.mockResolvedValueOnce(existingMapping);
      mockAuthService.getValidAccessToken.mockResolvedValueOnce('token-1');

      await service.syncShiftToGoogleCalendar(jobData);

      expect(mockGoogleCalendarProvider.updateEvent).toHaveBeenCalledWith(
        'token-1',
        'uuid1',
        expect.any(Object),
      );
    });

    it('should handle 409 Conflict idempotently by updating instead', async () => {
      mockAuthService.getConnectionByProvider.mockResolvedValueOnce({ id: 'conn-1' });
      const existingMapping = { id: 'uuid-1', externalEventId: null }; // Exists but no external ID saved yet
      mockMappingRepo.findOne.mockResolvedValueOnce(existingMapping);
      mockAuthService.getValidAccessToken.mockResolvedValueOnce('token-1');
      
      const conflictError = new Error('Conflict');
      (conflictError as any).code = 409;
      mockGoogleCalendarProvider.createEvent.mockRejectedValueOnce(conflictError);

      await service.syncShiftToGoogleCalendar(jobData);

      expect(mockGoogleCalendarProvider.createEvent).toHaveBeenCalled();
      expect(mockGoogleCalendarProvider.updateEvent).toHaveBeenCalled(); // Should fallback to update
      expect(mockMappingRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        syncStatus: CalendarSyncStatus.SUCCESS,
      }));
    });
  });

  describe('deleteShiftFromGoogleCalendar', () => {
    const deleteData: IDeleteCalendarShiftJobData = {
      userId: 'user-1',
      shiftId: 'shift-1',
    };

    it('should do nothing if no connection', async () => {
      mockAuthService.getConnectionByProvider.mockResolvedValueOnce(null);
      await service.deleteShiftFromGoogleCalendar(deleteData);
      expect(mockMappingRepo.findOne).not.toHaveBeenCalled();
    });

    it('should do nothing if mapping not found', async () => {
      mockAuthService.getConnectionByProvider.mockResolvedValueOnce({ id: 'conn-1' });
      mockMappingRepo.findOne.mockResolvedValueOnce(null);
      await service.deleteShiftFromGoogleCalendar(deleteData);
      expect(mockGoogleCalendarProvider.deleteEvent).not.toHaveBeenCalled();
    });

    it('should call deleteEvent and remove mapping', async () => {
      mockAuthService.getConnectionByProvider.mockResolvedValueOnce({ id: 'conn-1' });
      const mapping = { id: 'uuid-1', externalEventId: 'uuid1' };
      mockMappingRepo.findOne.mockResolvedValueOnce(mapping);
      mockAuthService.getValidAccessToken.mockResolvedValueOnce('token-1');

      await service.deleteShiftFromGoogleCalendar(deleteData);

      expect(mockGoogleCalendarProvider.deleteEvent).toHaveBeenCalledWith('token-1', 'uuid1');
      expect(mockMappingRepo.remove).toHaveBeenCalledWith(mapping);
    });

    it('should gracefully handle 404/410 from Google and still remove mapping', async () => {
      mockAuthService.getConnectionByProvider.mockResolvedValueOnce({ id: 'conn-1' });
      const mapping = { id: 'uuid-1', externalEventId: 'uuid1' };
      mockMappingRepo.findOne.mockResolvedValueOnce(mapping);
      mockAuthService.getValidAccessToken.mockResolvedValueOnce('token-1');

      const notFoundError = new Error('Not found');
      (notFoundError as any).code = 404;
      mockGoogleCalendarProvider.deleteEvent.mockRejectedValueOnce(notFoundError);

      await service.deleteShiftFromGoogleCalendar(deleteData);

      expect(mockMappingRepo.remove).toHaveBeenCalledWith(mapping);
    });
  });
});
