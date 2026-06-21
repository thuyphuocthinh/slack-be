import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpStatus } from '@nestjs/common';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { WorkspaceCalendarPolicyEntity } from '../entity/workspace_calendar_policy.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { CALENDAR_ERROR, WorkspaceRoleEnum } from '@slack/constants';
import { ShiftLocation } from '../types/calendar.enum';
import { WorkShiftValidationPayload } from '../types/calendar.type';
import { CachedService } from '@slack/cached/cached.service';
import { CalendarCommonService } from './calendar-common.service';

describe('WorkspaceCalendarPolicyService', () => {
  let service: WorkspaceCalendarPolicyService;
  let policyRepository: Repository<WorkspaceCalendarPolicyEntity>;
  let workShiftRepository: Repository<WorkShiftEntity>;
  let calendarCommonService: jest.Mocked<Pick<CalendarCommonService, 'isPrivileged' | 'fetchMember' | 'assertPrivileged'>>;

  const mockWorkspaceId = 'workspace-1';
  const mockUserId = 'user-1';

  beforeEach(async () => {
    calendarCommonService = {
      isPrivileged: jest.fn().mockImplementation((role) => role === 'admin' || role === 'owner'),
      fetchMember: jest.fn(),
      assertPrivileged: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceCalendarPolicyService,
        {
          provide: CalendarCommonService,
          useValue: calendarCommonService,
        },
        {
          provide: CachedService,
          useValue: {
            getOrSetDetail: jest.fn((_key, _ttl, fetcher) => fetcher()),
            del: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WorkspaceCalendarPolicyEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WorkShiftEntity),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceCalendarPolicyService>(WorkspaceCalendarPolicyService);
    policyRepository = module.get<Repository<WorkspaceCalendarPolicyEntity>>(
      getRepositoryToken(WorkspaceCalendarPolicyEntity),
    );
    workShiftRepository = module.get<Repository<WorkShiftEntity>>(getRepositoryToken(WorkShiftEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPolicy', () => {
    it('should return policy for a given workspaceId', async () => {
      const mockPolicy = { id: 'policy-1', workspaceId: mockWorkspaceId } as WorkspaceCalendarPolicyEntity;
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(mockPolicy);

      const result = await service.getPolicy(mockWorkspaceId);
      expect(result).toEqual(mockPolicy);
      expect(policyRepository.findOne).toHaveBeenCalledWith({ where: { workspaceId: mockWorkspaceId } });
    });
  });

  describe('validateShifts', () => {
    it('should pass validation when shifts are within limits (using defaults)', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(workShiftRepository, 'find').mockResolvedValue([]);

      const shifts: WorkShiftValidationPayload[] = [
        {
          workDate: '2026-06-01',
          startTime: new Date('2026-06-01T09:00:00Z'),
          endTime: new Date('2026-06-01T17:00:00Z'), // 8 hours
          location: ShiftLocation.WFH,
        },
      ];

      await expect(service.validateShifts(mockWorkspaceId, mockUserId, 'FULLTIME', WorkspaceRoleEnum.OWNER, shifts)).resolves.not.toThrow();
    });

    it('should throw an error if WFH limit is exceeded', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null);

      // Existing shifts: 4 WFH days already this week (June 1-4)
      const existingShifts = [
        { workDate: '2026-06-01', location: ShiftLocation.WFH, startTime: new Date(), endTime: new Date() },
        { workDate: '2026-06-02', location: ShiftLocation.WFH, startTime: new Date(), endTime: new Date() },
        { workDate: '2026-06-03', location: ShiftLocation.WFH, startTime: new Date(), endTime: new Date() },
        { workDate: '2026-06-04', location: ShiftLocation.WFH, startTime: new Date(), endTime: new Date() },
      ] as WorkShiftEntity[];

      jest.spyOn(workShiftRepository, 'find').mockResolvedValue(existingShifts);

      const shifts: WorkShiftValidationPayload[] = [
        {
          workDate: '2026-06-05', // Attempting to add 5th WFH day in the same week
          startTime: new Date('2026-06-05T09:00:00Z'),
          endTime: new Date('2026-06-05T17:00:00Z'),
          location: ShiftLocation.WFH,
        },
      ];

      await expect(service.validateShifts(mockWorkspaceId, mockUserId, 'FULLTIME', WorkspaceRoleEnum.OWNER, shifts)).rejects.toMatchObject({
        error: {
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.WFH_LIMIT_EXCEEDED,
          message: 'Vượt quá 4 ngày WFH/tuần',
        },
      });
    });

    it('should throw an error if Max Hours limit is exceeded for FULLTIME', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null); // default 208 hours

      // Existing shifts: 205 hours
      const existingShifts = [
        {
          workDate: '2026-06-01',
          startTime: new Date('2026-06-01T00:00:00Z'),
          endTime: new Date(new Date('2026-06-01T00:00:00Z').getTime() + 205 * 60 * 60 * 1000), // 205 hours
          location: ShiftLocation.OFFICE,
        },
      ] as WorkShiftEntity[];

      jest.spyOn(workShiftRepository, 'find').mockResolvedValue(existingShifts);

      const shifts: WorkShiftValidationPayload[] = [
        {
          workDate: '2026-06-20',
          startTime: new Date('2026-06-20T09:00:00Z'),
          endTime: new Date('2026-06-20T13:00:00Z'), // 4 hours -> Total 209 > 208
          location: ShiftLocation.OFFICE,
        },
      ];

      await expect(service.validateShifts(mockWorkspaceId, mockUserId, 'FULLTIME', WorkspaceRoleEnum.OWNER, shifts)).rejects.toMatchObject({
        error: {
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.MAX_HOURS_EXCEEDED,
          message: 'Vượt quá giới hạn 208 giờ làm việc trong tháng',
        },
      });
    });

    it('should not count existing shift hours if it is being updated', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null);

      // Existing shift has id 'shift-1' and takes 200 hours
      const existingShifts = [
        {
          id: 'shift-1',
          workDate: '2026-06-01',
          startTime: new Date('2026-06-01T00:00:00Z'),
          endTime: new Date(new Date('2026-06-01T00:00:00Z').getTime() + 200 * 60 * 60 * 1000),
          location: ShiftLocation.OFFICE,
        },
      ] as WorkShiftEntity[];

      jest.spyOn(workShiftRepository, 'find').mockResolvedValue(existingShifts);

      // Updating 'shift-1' to 205 hours — should pass (205 <= 208)
      const shifts: WorkShiftValidationPayload[] = [
        {
          id: 'shift-1',
          workDate: '2026-06-01',
          startTime: new Date('2026-06-01T00:00:00Z'),
          endTime: new Date(new Date('2026-06-01T00:00:00Z').getTime() + 205 * 60 * 60 * 1000),
          location: ShiftLocation.OFFICE,
        },
      ];

      await expect(service.validateShifts(mockWorkspaceId, mockUserId, 'FULLTIME', WorkspaceRoleEnum.OWNER, shifts)).resolves.not.toThrow();
    });
  });

  describe('checkLockDeadline', () => {
    it('should allow ADMIN and OWNER to bypass the lock check', async () => {
      const pastDates = ['2026-05-01'];
      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.ADMIN, pastDates)).resolves.not.toThrow();
      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.OWNER, pastDates)).resolves.not.toThrow();
    });

    it('should throw an error if the date is locked for a MEMBER', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null); // default 25th

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-26T12:00:00Z')); // Today is June 26th

      const targetDates = ['2026-07-15']; // Target is July. Deadline was June 25th.

      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.MEMBER, targetDates)).rejects.toMatchObject({
        error: {
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.CALENDAR_LOCKED,
          message: 'Lịch đăng ký cho tháng 7/2026 đã khóa từ ngày 25/6. Vui lòng liên hệ Admin.',
        },
      });

      jest.useRealTimers();
    });

    it('should not throw an error if the deadline has not passed for a MEMBER', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null); // default 25th

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-24T12:00:00Z')); // Today is June 24th

      const targetDates = ['2026-07-15']; // Target is July. Deadline is June 25th.

      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.MEMBER, targetDates)).resolves.not.toThrow();

      jest.useRealTimers();
    });
  });
});
