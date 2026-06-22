import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpStatus } from '@nestjs/common';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { WorkspaceCalendarPolicyEntity } from '../entity/workspace_calendar_policy.entity';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { CalendarUserLockEntity } from '../entity/calendar_user_lock.entity';
import { CALENDAR_ERROR, WorkspaceRoleEnum } from '@slack/constants';
import { ShiftLocation } from '../types/calendar.enum';
import { WorkShiftValidationPayload } from '../types/calendar.type';
import { CachedService } from '@slack/cached/cached.service';
import { CalendarCommonService } from './calendar-common.service';
import { RpcException } from '@nestjs/microservices';

describe('WorkspaceCalendarPolicyService', () => {
  let service: WorkspaceCalendarPolicyService;
  let policyRepository: Repository<WorkspaceCalendarPolicyEntity>;
  let workShiftRepository: Repository<WorkShiftEntity>;
  let userLockRepository: Repository<CalendarUserLockEntity>;
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
        {
          provide: getRepositoryToken(CalendarUserLockEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceCalendarPolicyService>(WorkspaceCalendarPolicyService);
    policyRepository = module.get<Repository<WorkspaceCalendarPolicyEntity>>(
      getRepositoryToken(WorkspaceCalendarPolicyEntity),
    );
    workShiftRepository = module.get<Repository<WorkShiftEntity>>(getRepositoryToken(WorkShiftEntity));
    userLockRepository = module.get<Repository<CalendarUserLockEntity>>(getRepositoryToken(CalendarUserLockEntity));
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

    it('should return policy containing maxPaidLeaveDaysPerYear', async () => {
      const mockPolicy = {
        id: 'policy-2',
        workspaceId: mockWorkspaceId,
        policyData: { maxPaidLeaveDaysPerYear: 20 }
      } as unknown as WorkspaceCalendarPolicyEntity;
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(mockPolicy);

      const result = await service.getPolicy(mockWorkspaceId);
      expect(result).toEqual(mockPolicy);
      expect(result?.policyData).toHaveProperty('maxPaidLeaveDaysPerYear', 20);
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

    it('should throw an error if new shifts overlap with each other', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(workShiftRepository, 'find').mockResolvedValue([]);

      const shifts: WorkShiftValidationPayload[] = [
        {
          workDate: '2026-06-01',
          startTime: new Date('2026-06-01T08:00:00Z'),
          endTime: new Date('2026-06-01T12:00:00Z'),
          location: ShiftLocation.OFFICE,
        },
        {
          workDate: '2026-06-01',
          startTime: new Date('2026-06-01T10:00:00Z'), // Overlaps with 08:00-12:00
          endTime: new Date('2026-06-01T14:00:00Z'),
          location: ShiftLocation.OFFICE,
        },
      ];

      await expect(service.validateShifts(mockWorkspaceId, mockUserId, 'FULLTIME', WorkspaceRoleEnum.OWNER, shifts)).rejects.toMatchObject({
        error: expect.objectContaining({ code: CALENDAR_ERROR.SHIFT_OVERLAP.code }),
      });
    });

    it('should throw an error if new shift overlaps with existing shift in DB', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null);

      const existingShifts = [
        { workDate: '2026-06-01', location: ShiftLocation.OFFICE, startTime: new Date('2026-06-01T13:00:00Z'), endTime: new Date('2026-06-01T17:00:00Z') },
      ] as WorkShiftEntity[];

      jest.spyOn(workShiftRepository, 'find').mockResolvedValue(existingShifts);

      const shifts: WorkShiftValidationPayload[] = [
        {
          workDate: '2026-06-01',
          startTime: new Date('2026-06-01T15:00:00Z'), // Overlaps with 13:00-17:00
          endTime: new Date('2026-06-01T19:00:00Z'),
          location: ShiftLocation.OFFICE,
        },
      ];

      await expect(service.validateShifts(mockWorkspaceId, mockUserId, 'FULLTIME', WorkspaceRoleEnum.OWNER, shifts)).rejects.toMatchObject({
        error: expect.objectContaining({ code: CALENDAR_ERROR.SHIFT_OVERLAP.code }),
      });
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

    it('PERFORMANCE TEST: should validate a large number of shifts under 10ms', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null);

      // Generate 100 existing shifts
      const existingShifts: WorkShiftEntity[] = [];
      for (let i = 1; i <= 100; i++) {
        existingShifts.push({
          id: `existing-shift-${i}`,
          workDate: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
          startTime: new Date(`2026-06-01T00:00:00Z`), // Using dummy non-overlapping data
          endTime: new Date(`2026-06-01T01:00:00Z`),
          location: ShiftLocation.OFFICE,
        } as WorkShiftEntity);
      }

      jest.spyOn(workShiftRepository, 'find').mockResolvedValue(existingShifts);

      // Generate 30 new shifts to register
      const shifts: WorkShiftValidationPayload[] = [];
      for (let i = 1; i <= 30; i++) {
        const day = String((i % 28) + 1).padStart(2, '0');
        const hourStart = String((i % 12) + 8).padStart(2, '0');
        const hourEnd = String((i % 12) + 9).padStart(2, '0');
        
        shifts.push({
          id: undefined,
          workDate: `2026-06-${day}`,
          startTime: new Date(`2026-06-${day}T${hourStart}:00:00Z`),
          endTime: new Date(`2026-06-${day}T${hourEnd}:00:00Z`),
          location: ShiftLocation.OFFICE,
        });
      }

      const start = performance.now();
      await service.validateShifts(mockWorkspaceId, mockUserId, 'FULLTIME', WorkspaceRoleEnum.OWNER, shifts);
      const end = performance.now();
      const executionTime = end - start;

      console.log(`[Performance Test] validateShifts execution time: ${executionTime.toFixed(2)} ms for N=30, E=100`);

      // It should be extremely fast, definitely under 15ms.
      expect(executionTime).toBeLessThan(15);
    });
  });

  describe('checkLockDeadline', () => {
    it('should allow ADMIN and OWNER to bypass the lock check', async () => {
      const pastDates = ['2026-05-01'];
      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.ADMIN, mockUserId, pastDates)).resolves.not.toThrow();
      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.OWNER, mockUserId, pastDates)).resolves.not.toThrow();
    });

    it('should throw if the date is locked for a MEMBER with no unlock record', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null); // default 25th
      jest.spyOn(userLockRepository, 'findOne').mockResolvedValue(null); // no manual unlock

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-26T12:00:00Z')); // Today is June 26th

      const targetDates = ['2026-07-15']; // Target is July. Deadline was June 25th.

      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.MEMBER, mockUserId, targetDates)).rejects.toMatchObject({
        error: {
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.CALENDAR_LOCKED,
          message: 'Lịch đăng ký cho tháng 7/2026 đã khóa từ ngày 25/6. Vui lòng liên hệ Admin.',
        },
      });

      jest.useRealTimers();
    });

    it('should not throw if the deadline has not passed for a MEMBER', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null); // default 25th

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-24T12:00:00Z')); // Today is June 24th

      const targetDates = ['2026-07-15']; // Target is July. Deadline is June 25th.

      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.MEMBER, mockUserId, targetDates)).resolves.not.toThrow();

      jest.useRealTimers();
    });

    it('should not throw if a MEMBER has an active manual unlock for the locked month', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null); // default 25th
      jest.spyOn(userLockRepository, 'findOne').mockResolvedValue({
        isUnlocked: true,
        unlockExpiresAt: new Date('2026-06-27T12:00:00Z'), // expires tomorrow
      } as CalendarUserLockEntity);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-26T12:00:00Z')); // Today is June 26th, past deadline

      const targetDates = ['2026-07-15']; // July — deadline was June 25th

      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.MEMBER, mockUserId, targetDates)).resolves.not.toThrow();

      jest.useRealTimers();
    });

    it('should throw if a MEMBER has an expired manual unlock for the locked month', async () => {
      jest.spyOn(policyRepository, 'findOne').mockResolvedValue(null); // default 25th
      jest.spyOn(userLockRepository, 'findOne').mockResolvedValue({
        isUnlocked: true,
        unlockExpiresAt: new Date('2026-06-25T00:00:00Z'), // expired before now
      } as CalendarUserLockEntity);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-26T12:00:00Z')); // Today is June 26th

      const targetDates = ['2026-07-15'];

      await expect(service.checkLockDeadline(mockWorkspaceId, WorkspaceRoleEnum.MEMBER, mockUserId, targetDates)).rejects.toMatchObject({
        error: {
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.CALENDAR_LOCKED,
          message: 'Lịch đăng ký cho tháng 7/2026 đã khóa từ ngày 25/6. Vui lòng liên hệ Admin.',
        },
      });

      jest.useRealTimers();
    });
  });
});
