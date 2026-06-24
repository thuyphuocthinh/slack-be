import { Test, TestingModule } from '@nestjs/testing';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { google } from 'googleapis';

jest.mock('googleapis', () => {
  const mockInsert = jest.fn();
  const mockUpdate = jest.fn();
  const mockDelete = jest.fn();

  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          setCredentials: jest.fn(),
        })),
      },
      calendar: jest.fn().mockReturnValue({
        events: {
          insert: mockInsert,
          update: mockUpdate,
          delete: mockDelete,
        },
      }),
    },
  };
});

describe('GoogleCalendarProvider', () => {
  let provider: GoogleCalendarProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GoogleCalendarProvider],
    }).compile();

    provider = module.get<GoogleCalendarProvider>(GoogleCalendarProvider);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('createEvent', () => {
    it('should call calendar.events.insert and return id', async () => {
      const mockInsert = google.calendar({ version: 'v3', auth: null as any }).events.insert as jest.Mock;
      mockInsert.mockResolvedValueOnce({ data: { id: 'test-event-id' } });

      const eventParams = { summary: 'Test Event' };
      const result = await provider.createEvent('token', 'req-id', eventParams);

      expect(mockInsert).toHaveBeenCalledWith({
        calendarId: 'primary',
        requestBody: { ...eventParams, id: 'req-id' },
      });
      expect(result).toBe('test-event-id');
    });

    it('should return eventId if response data id is missing', async () => {
      const mockInsert = google.calendar({ version: 'v3', auth: null as any }).events.insert as jest.Mock;
      mockInsert.mockResolvedValueOnce({ data: {} });

      const result = await provider.createEvent('token', 'req-id', {});
      expect(result).toBe('req-id');
    });
  });

  describe('updateEvent', () => {
    it('should call calendar.events.update and return id', async () => {
      const mockUpdate = google.calendar({ version: 'v3', auth: null as any }).events.update as jest.Mock;
      mockUpdate.mockResolvedValueOnce({ data: { id: 'updated-id' } });

      const result = await provider.updateEvent('token', 'event-id', { summary: 'Updated' });

      expect(mockUpdate).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event-id',
        requestBody: { summary: 'Updated' },
      });
      expect(result).toBe('updated-id');
    });
  });

  describe('deleteEvent', () => {
    it('should call calendar.events.delete', async () => {
      const mockDelete = google.calendar({ version: 'v3', auth: null as any }).events.delete as jest.Mock;
      mockDelete.mockResolvedValueOnce({});

      await provider.deleteEvent('token', 'event-id');

      expect(mockDelete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event-id',
      });
    });
  });
});
