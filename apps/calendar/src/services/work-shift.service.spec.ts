import { Test, TestingModule } from '@nestjs/testing';
import { WorkShiftService } from './work-shift.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { AttendanceLogEntity } from '../entity/attendance_log.entity';
import { CALENDAR_ERROR, AUTH_ERROR } from '@slack/constants';
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ShiftLocation } from '../types/calendar.enum';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { CalendarCommonService } from './calendar-common.service';
import { QueueService, EQueueName, EJobName } from '@slack/queue';
import { WorkspaceHolidayService } from './workspace-holiday.service';

jest.mock('nanoid', () => ({
  customAlphabet: jest.fn(() => jest.fn(() => 'mock-id')),
}));

describe('WorkShiftService', () => {
  let service: WorkShiftService;
  let policyService: jest.Mocked<
    Pick<WorkspaceCalendarPolicyService, 'validateShifts' | 'checkLockDeadline'>
  >;
  let calendarCommonService: jest.Mocked<
    Pick<
      CalendarCommonService,
      | 'fetchMember'
      | 'isPrivileged'
      | 'assertSelfOrPrivileged'
      | 'assertPrivileged'
    >
  >;
  let queueService: jest.Mocked<Pick<QueueService, 'addJob' | 'addBulkJobs'>>;
  let workShiftRepository: any;
  let attendanceLogRepository: any;
  let reconciliationRepository: any;
  let holidayService: any;
  let txManager: any;
  let dataSource: any;

  const MEMBER = { id: 'member-1', role: 'member', employmentType: 'FULLTIME' };
  const ADMIN = { id: 'admin-1', role: 'admin', employmentType: 'FULLTIME' };

  const existingShift = {
    id: 'shift-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    workDate: '2026-06-15',
    startTime: new Date('2026-06-15T02:00:00Z'),
    endTime: new Date('2026-06-15T11:00:00Z'),
    location: ShiftLocation.OFFICE,
  };

  const forbiddenError = new RpcException({
    statusCode: HttpStatus.FORBIDDEN,
    ...AUTH_ERROR.FORBIDDEN,
  });

  beforeEach(async () => {
    workShiftRepository = {
      insert: jest
        .fn()
        .mockResolvedValue({ identifiers: [{ id: 'new-id-1' }] }),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const attendanceQueryBuilder = {
      distinctOn: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    attendanceLogRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(attendanceQueryBuilder),
    };
    reconciliationRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    txManager = {
      findOne: jest
        .fn()
        .mockImplementation((_entity: any, opts: any) =>
          workShiftRepository.findOne(opts),
        ),
      find: jest
        .fn()
        .mockImplementation((_entity: any, opts: any) =>
          workShiftRepository.find(opts),
        ),
      insert: jest
        .fn()
        .mockImplementation((_entity: any, data: any) =>
          workShiftRepository.insert(data),
        ),
      update: jest
        .fn()
        .mockImplementation((_entity: any, where: any, data: any) =>
          workShiftRepository.update(where, data),
        ),
      delete: jest
        .fn()
        .mockImplementation((_entity: any, criteria: any) =>
          workShiftRepository.delete(criteria),
        ),
      exists: jest.fn().mockResolvedValue(false),
    };

    dataSource = {
      transaction: jest.fn().mockImplementation(async (...args: any[]) => {
        const cb = args[args.length - 1];
        return cb(txManager);
      }),
    };

    calendarCommonService = {
      fetchMember: jest.fn(),
      isPrivileged: jest.fn().mockReturnValue(false), // default: member role
      assertSelfOrPrivileged: jest.fn(), // default: no-op (passes)
      assertPrivileged: jest.fn(),
    };

    policyService = {
      validateShifts: jest.fn().mockResolvedValue(undefined),
      checkLockDeadline: jest.fn().mockResolvedValue(undefined),
    };

    queueService = {
      addJob: jest.fn().mockResolvedValue(null),
      addBulkJobs: jest.fn().mockResolvedValue(null),
    };

    holidayService = {
      checkIfDatesAreHolidays: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkShiftService,
        {
          provide: getRepositoryToken(WorkShiftEntity),
          useValue: workShiftRepository,
        },
        {
          provide: getRepositoryToken(DailyReconciliationEntity),
          useValue: reconciliationRepository,
        },
        {
          provide: getRepositoryToken(AttendanceLogEntity),
          useValue: attendanceLogRepository,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: WorkspaceCalendarPolicyService, useValue: policyService },
        { provide: CalendarCommonService, useValue: calendarCommonService },
        { provide: QueueService, useValue: queueService },
        { provide: WorkspaceHolidayService, useValue: holidayService },
      ],
    }).compile();

    service = module.get<WorkShiftService>(WorkShiftService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── bulkRegisterShifts ──────────────────────────────────────────────────────

  describe('bulkRegisterShifts', () => {
    const validDto = {
      workspaceId: 'workspace-1',
      requestorId: 'user-1',
      userId: 'user-1',
      shifts: [
        {
          workDate: '2026-06-20',
          startTime: '2026-06-20T02:00:00.000Z',
          endTime: '2026-06-20T11:00:00.000Z',
        },
      ],
      location: ShiftLocation.OFFICE,
    };

    it('should successfully register shifts when user registers for themselves', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      const mockInsertedShifts = [
        {
          id: 'new-id-1',
          userId: validDto.userId,
          workspaceId: validDto.workspaceId,
          startTime: new Date(validDto.shifts[0].startTime),
          endTime: new Date(validDto.shifts[0].endTime),
          location: validDto.location,
        },
      ];
      workShiftRepository.find.mockResolvedValue(mockInsertedShifts);

      const result = await service.bulkRegisterShifts(validDto);

      expect(calendarCommonService.fetchMember).toHaveBeenCalledWith(
        validDto.workspaceId,
        validDto.requestorId,
      );
      expect(calendarCommonService.assertSelfOrPrivileged).toHaveBeenCalledWith(
        validDto.requestorId,
        validDto.userId,
        MEMBER.role,
      );
      expect(workShiftRepository.insert).toHaveBeenCalled();
      expect(queueService.addBulkJobs).toHaveBeenCalledWith(
        EQueueName.INTEGRATION_SYNC_QUEUE,
        expect.any(Array),
      );
      expect(result).toBeInstanceOf(Array);
    });

    it('should throw FORBIDDEN when requestor is not a workspace member', async () => {
      calendarCommonService.fetchMember.mockRejectedValue(forbiddenError);

      await expect(service.bulkRegisterShifts(validDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...AUTH_ERROR.FORBIDDEN,
        }),
      );

      expect(workShiftRepository.insert).not.toHaveBeenCalled();
    });

    it('should throw FORBIDDEN when a member tries to register shifts for another user', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.assertSelfOrPrivileged.mockImplementation(() => {
        throw forbiddenError;
      });

      const dto = { ...validDto, userId: 'user-2' };

      await expect(service.bulkRegisterShifts(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...AUTH_ERROR.FORBIDDEN,
        }),
      );

      expect(workShiftRepository.insert).not.toHaveBeenCalled();
    });

    it('should allow admin to register shifts for another user', async () => {
      calendarCommonService.fetchMember
        .mockResolvedValueOnce(ADMIN) // requestor
        .mockResolvedValueOnce(MEMBER); // target user
      const dto = { ...validDto, requestorId: 'admin-user', userId: 'user-2' };
      const mockInsertedShifts = [
        {
          id: 'new-id-1',
          userId: dto.userId,
          workspaceId: dto.workspaceId,
          startTime: new Date(validDto.shifts[0].startTime),
          endTime: new Date(validDto.shifts[0].endTime),
          location: validDto.location,
        },
      ];
      workShiftRepository.find.mockResolvedValue(mockInsertedShifts);

      const result = await service.bulkRegisterShifts(dto);

      expect(workShiftRepository.insert).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Array);
    });

    it('should successfully register multiple shifts on the same day', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      const multiShiftDto = {
        ...validDto,
        shifts: [
          {
            workDate: '2026-06-20',
            startTime: '2026-06-20T02:00:00.000Z',
            endTime: '2026-06-20T06:00:00.000Z',
          },
          {
            workDate: '2026-06-20',
            startTime: '2026-06-20T08:00:00.000Z',
            endTime: '2026-06-20T12:00:00.000Z',
          },
        ],
      };

      const mockInsertedShifts = [
        {
          id: 'new-id-1',
          userId: multiShiftDto.userId,
          workspaceId: multiShiftDto.workspaceId,
          startTime: new Date(multiShiftDto.shifts[0].startTime),
          endTime: new Date(multiShiftDto.shifts[0].endTime),
          location: multiShiftDto.location,
        },
        {
          id: 'new-id-2',
          userId: multiShiftDto.userId,
          workspaceId: multiShiftDto.workspaceId,
          startTime: new Date(multiShiftDto.shifts[1].startTime),
          endTime: new Date(multiShiftDto.shifts[1].endTime),
          location: multiShiftDto.location,
        },
      ];
      workShiftRepository.find.mockResolvedValue(mockInsertedShifts);

      const result = await service.bulkRegisterShifts(multiShiftDto);

      expect(policyService.checkLockDeadline).toHaveBeenCalledWith(
        multiShiftDto.workspaceId,
        MEMBER.role,
        multiShiftDto.userId,
        expect.arrayContaining(['2026-06-20', '2026-06-20']),
      );
      expect(policyService.validateShifts).toHaveBeenCalledWith(
        multiShiftDto.workspaceId,
        multiShiftDto.userId,
        MEMBER.employmentType,
        expect.arrayContaining([
          expect.objectContaining({
            startTime: new Date('2026-06-20T02:00:00.000Z'),
          }),
          expect.objectContaining({
            startTime: new Date('2026-06-20T08:00:00.000Z'),
          }),
        ]),
        expect.anything(), // transaction manager
      );
      expect(result).toBeInstanceOf(Array);
    });

    it('should skip shift registration if the date is a holiday', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      holidayService.checkIfDatesAreHolidays.mockResolvedValueOnce({
        '2026-06-20': true,
      });

      const result = await service.bulkRegisterShifts(validDto);
      expect(workShiftRepository.insert).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should throw BAD_REQUEST if shift times are not strictly UTC', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);

      const invalidDto = {
        ...validDto,
        shifts: [
          {
            workDate: '2026-06-20',
            startTime: '2026-06-20T02:00:00.000',
            endTime: '2026-06-20T11:00:00.000Z',
          },
        ],
      };

      await expect(
        service.bulkRegisterShifts(invalidDto),
      ).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.INVALID_TIME_UTC,
        }),
      );

      expect(workShiftRepository.insert).not.toHaveBeenCalled();
    });

    it('should throw INTERNAL_SERVER_ERROR on repository failure', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.insert.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(service.bulkRegisterShifts(validDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.BULK_REGISTER_FAILED,
        }),
      );
    });

    it('should call checkLockDeadline explicitly before validateShifts', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      const mockInsertedShifts = [
        {
          id: 'new-id-1',
          userId: validDto.userId,
          workspaceId: validDto.workspaceId,
          startTime: new Date(validDto.shifts[0].startTime),
          endTime: new Date(validDto.shifts[0].endTime),
          location: validDto.location,
        },
      ];
      workShiftRepository.find.mockResolvedValue(mockInsertedShifts);

      await service.bulkRegisterShifts(validDto);

      expect(policyService.checkLockDeadline).toHaveBeenCalledWith(
        validDto.workspaceId,
        MEMBER.role,
        validDto.userId,
        [validDto.shifts[0].workDate],
      );
      expect(policyService.validateShifts).toHaveBeenCalled();
    });
  });

  // ─── getWorkShifts ───────────────────────────────────────────────────────────

  describe('getWorkShifts', () => {
    const validQuery = {
      workspaceId: 'workspace-1',
      requestorId: 'user-1',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    };

    const mockShifts = [
      {
        id: 'shift-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workDate: '2026-06-15',
        startTime: new Date('2026-06-15T02:00:00Z'),
        endTime: new Date('2026-06-15T11:00:00Z'),
        location: ShiftLocation.OFFICE,
      },
    ];

    it('should fetch own shifts for a member (forces userId filter to requestorId)', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);
      workShiftRepository.findAndCount.mockResolvedValue([mockShifts, 1]);

      const result = await service.getWorkShifts(validQuery);

      expect(workShiftRepository.findAndCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          workspaceId: validQuery.workspaceId,
          userId: validQuery.requestorId,
          workDate: expect.any(Object),
        }),
        order: { workDate: 'ASC', startTime: 'ASC' },
        skip: 0,
        take: 50,
      });
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data[0]).toHaveProperty('id', 'shift-1');
      expect(result.paging).toEqual({
        page: 1,
        limit: 50,
        total: 1,
        totalPages: 1,
      });
    });

    it('should apply page/limit as skip/take', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);
      workShiftRepository.findAndCount.mockResolvedValue([mockShifts, 120]);

      const result = await service.getWorkShifts({
        ...validQuery,
        page: 3,
        limit: 50,
      });

      expect(workShiftRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 50 }),
      );
      expect(result.paging).toEqual({
        page: 3,
        limit: 50,
        total: 120,
        totalPages: 3,
      });
    });

    it('should map inOutStatus from only the latest attendance log', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);

      workShiftRepository.findAndCount.mockResolvedValue([
        [
          mockShifts[0],
          { ...mockShifts[0], id: 'shift-2' },
          { ...mockShifts[0], id: 'shift-3' },
        ],
        3,
      ]);
      const queryBuilder = attendanceLogRepository.createQueryBuilder();
      queryBuilder.getRawMany.mockResolvedValue([
        { workShiftId: 'shift-2', logType: 'CHECK_IN' },
        { workShiftId: 'shift-3', logType: 'CHECK_OUT' },
      ]);

      const result = await service.getWorkShifts(validQuery);

      expect(result.data).toBeInstanceOf(Array);
      expect(result.data[0]).toHaveProperty('inOutStatus', 'NOT_STARTED');
      expect(result.data[1]).toHaveProperty('inOutStatus', 'IN');
      expect(result.data[2]).toHaveProperty('inOutStatus', 'OUT');
      expect(result.data[0]).toHaveProperty('hasAttendanceLogs', false);
      expect(result.data[1]).toHaveProperty('hasAttendanceLogs', true);
    });

    it("should throw FORBIDDEN when member tries to view another user's shifts", async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);

      const query = { ...validQuery, userId: 'user-2' };

      await expect(service.getWorkShifts(query)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...AUTH_ERROR.FORBIDDEN,
        }),
      );
    });

    it('should allow admin to filter shifts by another userId', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      calendarCommonService.isPrivileged.mockReturnValue(true);
      workShiftRepository.findAndCount.mockResolvedValue([mockShifts, 1]);

      const query = {
        ...validQuery,
        requestorId: 'admin-user',
        userId: 'user-2',
      };
      await service.getWorkShifts(query);

      expect(workShiftRepository.findAndCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          workspaceId: validQuery.workspaceId,
          userId: 'user-2',
        }),
        order: { workDate: 'ASC', startTime: 'ASC' },
        skip: 0,
        take: 50,
      });
    });

    it('should allow admin to fetch all shifts without userId filter, paginated', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      calendarCommonService.isPrivileged.mockReturnValue(true);
      workShiftRepository.findAndCount.mockResolvedValue([mockShifts, 31284]);

      await service.getWorkShifts({ ...validQuery, requestorId: 'admin-user' });

      const [findArg] = workShiftRepository.findAndCount.mock.calls[0];
      expect(findArg.where).not.toHaveProperty('userId');
      expect(findArg.take).toBe(50);
    });

    it('should throw INTERNAL_SERVER_ERROR on repository failure', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);
      workShiftRepository.findAndCount.mockRejectedValue(new Error('DB error'));

      await expect(service.getWorkShifts(validQuery)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.FETCH_SHIFTS_FAILED,
        }),
      );
    });
  });

  describe('getWorkShiftDetail', () => {
    it('should fetch attendance logs only for the selected shift', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.findOne.mockResolvedValue({
        ...existingShift,
        attendanceLogs: [
          { logType: 'CHECK_IN', recordedAt: new Date('2026-06-15T02:00:00Z') },
        ],
      });

      const result = await service.getWorkShiftDetail({
        id: existingShift.id,
        workspaceId: existingShift.workspaceId,
        requestorId: existingShift.userId,
      });

      expect(workShiftRepository.findOne).toHaveBeenCalledWith({
        where: { id: existingShift.id, workspaceId: existingShift.workspaceId },
        relations: ['attendanceLogs'],
      });
      expect(result).toHaveProperty('hasAttendanceLogs', true);
      expect(result).toHaveProperty('inOutStatus', 'IN');
    });
  });

  // ─── updateWorkShift ─────────────────────────────────────────────────────────

  describe('updateWorkShift', () => {
    const dto = {
      id: 'shift-1',
      workspaceId: 'workspace-1',
      requestorId: 'user-1',
      userId: 'user-1',
      location: ShiftLocation.WFH,
    };

    it('should successfully update own shift', async () => {
      const updatedShift = { ...existingShift, location: ShiftLocation.WFH };
      // 1st: pre-transaction findOne, 2nd: locked findOne inside tx, 3rd: final read inside tx
      workShiftRepository.findOne
        .mockResolvedValueOnce(existingShift)
        .mockResolvedValueOnce(existingShift)
        .mockResolvedValueOnce(updatedShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);

      const result = await service.updateWorkShift(dto);

      expect(workShiftRepository.update).toHaveBeenCalledWith(
        { id: dto.id, workspaceId: dto.workspaceId, userId: dto.userId },
        { location: dto.location },
      );
      expect(queueService.addJob).toHaveBeenCalledWith(
        EQueueName.INTEGRATION_SYNC_QUEUE,
        EJobName.SYNC_CALENDAR_SHIFT,
        expect.objectContaining({
          shiftId: 'shift-1',
          location: ShiftLocation.WFH,
        }),
      );
      expect(result).toHaveProperty('id', 'shift-1');
      expect(result).toHaveProperty('location', ShiftLocation.WFH);
    });

    it('should throw SHIFT_NOT_FOUND if shift does not exist', async () => {
      workShiftRepository.findOne.mockResolvedValue(null);

      await expect(service.updateWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.SHIFT_NOT_FOUND,
        }),
      );
    });

    it('should reject deletion when the shift has attendance logs', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      txManager.exists.mockResolvedValue(true);

      await expect(service.deleteWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.CONFLICT,
          ...CALENDAR_ERROR.SHIFT_HAS_ATTENDANCE_LOGS,
        }),
      );
      expect(workShiftRepository.delete).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when member tries to update another user's shift", async () => {
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.assertSelfOrPrivileged.mockImplementation(() => {
        throw forbiddenError;
      });

      const otherUserDto = { ...dto, requestorId: 'user-2' };

      await expect(service.updateWorkShift(otherUserDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...AUTH_ERROR.FORBIDDEN,
        }),
      );

      expect(workShiftRepository.update).not.toHaveBeenCalled();
    });

    it('should throw FORBIDDEN when someone other than the owner tries to update notes', async () => {
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN); // Even admin cannot update notes

      const updateNotesDto = {
        ...dto,
        requestorId: 'admin-user',
        userId: 'user-1',
        notes: 'New Note',
      };

      await expect(
        service.updateWorkShift(updateNotesDto),
      ).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.ONLY_OWNER_CAN_UPDATE_NOTES,
        }),
      );

      expect(workShiftRepository.update).not.toHaveBeenCalled();
    });

    it('should successfully update notes if requestor is the owner', async () => {
      workShiftRepository.findOne
        .mockResolvedValueOnce(existingShift) // pre-tx check
        .mockResolvedValueOnce(existingShift) // locked read inside tx
        .mockResolvedValueOnce({ ...existingShift, notes: 'New Note' }); // final read inside tx
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);

      const updateNotesDto = {
        ...dto,
        requestorId: 'user-1',
        userId: 'user-1',
        notes: 'New Note',
      };
      const result = await service.updateWorkShift(updateNotesDto);

      expect(workShiftRepository.update).toHaveBeenCalledWith(
        { id: dto.id, workspaceId: dto.workspaceId, userId: dto.userId },
        { location: dto.location, notes: 'New Note' },
      );
      expect(result).toHaveProperty('notes', 'New Note');
    });

    it("should allow admin to update another user's shift", async () => {
      workShiftRepository.findOne
        .mockResolvedValueOnce(existingShift) // pre-tx check
        .mockResolvedValueOnce(existingShift) // locked read inside tx
        .mockResolvedValueOnce({
          ...existingShift,
          location: ShiftLocation.WFH,
        }); // final read inside tx
      calendarCommonService.fetchMember
        .mockResolvedValueOnce(ADMIN) // requestor
        .mockResolvedValueOnce(MEMBER); // target user

      const adminDto = { ...dto, requestorId: 'admin-user' };
      const result = await service.updateWorkShift(adminDto);

      expect(workShiftRepository.update).toHaveBeenCalled();
      expect(result).toHaveProperty('id', 'shift-1');
    });

    it('should throw BAD_REQUEST if startTime is not strictly UTC', async () => {
      const invalidDto = { ...dto, startTime: '2026-06-20T02:00:00.000' };

      await expect(service.updateWorkShift(invalidDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.INVALID_TIME_UTC,
        }),
      );
    });

    it('should return existing shift without calling update when no fields change', async () => {
      const emptyDto = {
        id: 'shift-1',
        workspaceId: 'ws-1',
        requestorId: 'user-1',
        userId: 'user-1',
      };
      workShiftRepository.findOne.mockResolvedValue(existingShift);

      const result = await service.updateWorkShift(emptyDto);

      expect(workShiftRepository.update).not.toHaveBeenCalled();
      expect(workShiftRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'shift-1', workspaceId: 'ws-1', userId: 'user-1' },
      });
      expect(result).toHaveProperty('id', 'shift-1');
    });

    it('should throw INTERNAL_SERVER_ERROR on repository failure', async () => {
      // 1st: pre-tx, 2nd: locked read inside tx — update then throws
      workShiftRepository.findOne
        .mockResolvedValueOnce(existingShift)
        .mockResolvedValueOnce(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.update.mockRejectedValue(new Error('DB error'));

      await expect(service.updateWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.UPDATE_SHIFT_FAILED,
        }),
      );
    });
  });

  // ─── deleteWorkShift ─────────────────────────────────────────────────────────

  describe('deleteWorkShift', () => {
    const dto = {
      id: 'shift-1',
      workspaceId: 'workspace-1',
      requestorId: 'user-1',
      userId: 'user-1',
    };

    it('should successfully delete own shift', async () => {
      // findOne is now inside the transaction (via txManager → workShiftRepository.findOne)
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);

      const result = await service.deleteWorkShift(dto);

      expect(workShiftRepository.delete).toHaveBeenCalledWith({
        id: dto.id,
        workspaceId: dto.workspaceId,
        userId: dto.userId,
      });
      expect(queueService.addJob).toHaveBeenCalledWith(
        EQueueName.INTEGRATION_SYNC_QUEUE,
        EJobName.DELETE_CALENDAR_SHIFT,
        { shiftId: dto.id, userId: dto.userId },
      );
      expect(result).toEqual('Work shift deleted successfully');
    });

    it('should throw SHIFT_NOT_FOUND if shift does not exist', async () => {
      // auth runs first, then transaction findOne returns null
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.findOne.mockResolvedValue(null); // inside tx

      await expect(service.deleteWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.SHIFT_NOT_FOUND,
        }),
      );

      expect(workShiftRepository.delete).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when member tries to delete another user's shift", async () => {
      // auth check runs BEFORE the transaction now
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.assertSelfOrPrivileged.mockImplementation(() => {
        throw forbiddenError;
      });

      const otherUserDto = { ...dto, requestorId: 'user-2' };

      await expect(service.deleteWorkShift(otherUserDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...AUTH_ERROR.FORBIDDEN,
        }),
      );

      expect(workShiftRepository.delete).not.toHaveBeenCalled();
    });

    it("should allow admin to delete another user's shift", async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      workShiftRepository.findOne.mockResolvedValue(existingShift); // inside tx

      const adminDto = { ...dto, requestorId: 'admin-user' };
      const result = await service.deleteWorkShift(adminDto);

      expect(workShiftRepository.delete).toHaveBeenCalled();
      expect(result).toEqual('Work shift deleted successfully');
    });

    it('should throw INTERNAL_SERVER_ERROR on repository failure', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.findOne.mockResolvedValue(existingShift); // inside tx
      workShiftRepository.delete.mockRejectedValue(new Error('DB error'));

      await expect(service.deleteWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.DELETE_SHIFT_FAILED,
        }),
      );
    });
  });

  // ─── syncCalendar ────────────────────────────────────────────────────────────

  describe('syncCalendar', () => {
    const dto = {
      workspaceId: 'workspace-1',
      userId: 'user-1',
    };

    it('should chunk and add bulk jobs', async () => {
      const mockShifts = Array.from({ length: 600 }).map((_, i) => ({
        id: `shift-${i}`,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        startTime: new Date('2026-06-15T02:00:00Z'),
        endTime: new Date('2026-06-15T11:00:00Z'),
        location: ShiftLocation.OFFICE,
      }));

      // 1st call: returns 500
      // 2nd call: returns 100
      // 3rd call: returns 0
      workShiftRepository.find
        .mockResolvedValueOnce(mockShifts.slice(0, 500))
        .mockResolvedValueOnce(mockShifts.slice(500, 600))
        .mockResolvedValueOnce([]);

      const result = await service.syncCalendar(dto);

      expect(workShiftRepository.find).toHaveBeenCalledTimes(3);
      expect(queueService.addBulkJobs).toHaveBeenCalledTimes(2); // 2 batches
      expect(result).toEqual({
        message: 'Successfully queued 600 shifts for synchronization.',
        totalQueued: 600,
      });
    });

    it('should handle repository failure gracefully', async () => {
      workShiftRepository.find.mockRejectedValue(new Error('DB failure'));

      await expect(service.syncCalendar(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to queue shifts for synchronization',
        }),
      );
    });
  });
});
