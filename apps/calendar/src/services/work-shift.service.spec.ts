import { Test, TestingModule } from '@nestjs/testing';
import { WorkShiftService } from './work-shift.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { CALENDAR_ERROR, AUTH_ERROR } from '@slack/constants';
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ShiftLocation } from '../types/calendar.enum';
import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { CalendarCommonService } from './calendar-common.service';

describe('WorkShiftService', () => {
  let service: WorkShiftService;
  let policyService: jest.Mocked<Pick<WorkspaceCalendarPolicyService, 'validateShifts' | 'checkLockDeadline'>>;
  let calendarCommonService: jest.Mocked<Pick<CalendarCommonService, 'fetchMember' | 'isPrivileged' | 'assertSelfOrPrivileged' | 'assertPrivileged'>>;
  let workShiftRepository: any;

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

  const forbiddenError = new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN });

  beforeEach(async () => {
    workShiftRepository = {
      upsert: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    calendarCommonService = {
      fetchMember: jest.fn(),
      isPrivileged: jest.fn().mockReturnValue(false), // default: member role
      assertSelfOrPrivileged: jest.fn(),              // default: no-op (passes)
      assertPrivileged: jest.fn(),
    };

    policyService = {
      validateShifts: jest.fn().mockResolvedValue(undefined),
      checkLockDeadline: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkShiftService,
        {
          provide: getRepositoryToken(WorkShiftEntity),
          useValue: workShiftRepository,
        },
        {
          provide: WorkspaceCalendarPolicyService,
          useValue: policyService,
        },
        {
          provide: CalendarCommonService,
          useValue: calendarCommonService,
        },
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
      workShiftRepository.find.mockResolvedValue([]);

      const result = await service.bulkRegisterShifts(validDto);

      expect(calendarCommonService.fetchMember).toHaveBeenCalledWith(validDto.workspaceId, validDto.requestorId);
      expect(calendarCommonService.assertSelfOrPrivileged).toHaveBeenCalledWith(validDto.requestorId, validDto.userId, MEMBER.role);
      expect(workShiftRepository.upsert).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Array);
    });

    it('should throw FORBIDDEN when requestor is not a workspace member', async () => {
      calendarCommonService.fetchMember.mockRejectedValue(forbiddenError);

      await expect(service.bulkRegisterShifts(validDto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN }),
      );

      expect(workShiftRepository.upsert).not.toHaveBeenCalled();
    });

    it('should throw FORBIDDEN when a member tries to register shifts for another user', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.assertSelfOrPrivileged.mockImplementation(() => { throw forbiddenError; });

      const dto = { ...validDto, userId: 'user-2' };

      await expect(service.bulkRegisterShifts(dto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN }),
      );

      expect(workShiftRepository.upsert).not.toHaveBeenCalled();
    });

    it('should allow admin to register shifts for another user', async () => {
      calendarCommonService.fetchMember
        .mockResolvedValueOnce(ADMIN)   // requestor
        .mockResolvedValueOnce(MEMBER); // target user
      workShiftRepository.find.mockResolvedValue([]);

      const dto = { ...validDto, requestorId: 'admin-user', userId: 'user-2' };
      const result = await service.bulkRegisterShifts(dto);

      expect(workShiftRepository.upsert).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Array);
    });

    it('should throw BAD_REQUEST if shift times are not strictly UTC', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);

      const invalidDto = {
        ...validDto,
        shifts: [{ workDate: '2026-06-20', startTime: '2026-06-20T02:00:00.000', endTime: '2026-06-20T11:00:00.000Z' }],
      };

      await expect(service.bulkRegisterShifts(invalidDto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.BAD_REQUEST, ...CALENDAR_ERROR.INVALID_TIME_UTC }),
      );

      expect(workShiftRepository.upsert).not.toHaveBeenCalled();
    });

    it('should throw INTERNAL_SERVER_ERROR on repository failure', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.upsert.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.bulkRegisterShifts(validDto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, ...CALENDAR_ERROR.BULK_REGISTER_FAILED }),
      );
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
      workShiftRepository.find.mockResolvedValue(mockShifts);

      const result = await service.getWorkShifts(validQuery);

      expect(workShiftRepository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          workspaceId: validQuery.workspaceId,
          userId: validQuery.requestorId,
          workDate: expect.any(Object),
        }),
        relations: ['attendanceLogs'],
        order: { workDate: 'ASC', startTime: 'ASC' },
      });
      expect(result).toBeInstanceOf(Array);
      expect(result[0]).toHaveProperty('id', 'shift-1');
    });

    it('should correctly map inOutStatus based on attendanceLogs', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);
      
      const mockShiftsWithLogs = [
        { ...mockShifts[0], attendanceLogs: [] },
        { ...mockShifts[0], id: 'shift-2', attendanceLogs: [{ logType: 'CHECK_IN', recordedAt: new Date('2026-06-15T02:00:00Z') }] },
        { ...mockShifts[0], id: 'shift-3', attendanceLogs: [
            { logType: 'CHECK_IN', recordedAt: new Date('2026-06-15T02:00:00Z') },
            { logType: 'CHECK_OUT', recordedAt: new Date('2026-06-15T11:00:00Z') }
          ] 
        }
      ];
      workShiftRepository.find.mockResolvedValue(mockShiftsWithLogs);

      const result = await service.getWorkShifts(validQuery);

      expect(result).toBeInstanceOf(Array);
      expect(result[0]).toHaveProperty('inOutStatus', 'NOT_STARTED');
      expect(result[1]).toHaveProperty('inOutStatus', 'IN');
      expect(result[2]).toHaveProperty('inOutStatus', 'OUT');
    });

    it('should throw FORBIDDEN when member tries to view another user\'s shifts', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);

      const query = { ...validQuery, userId: 'user-2' };

      await expect(service.getWorkShifts(query)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN }),
      );
    });

    it('should allow admin to filter shifts by another userId', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      calendarCommonService.isPrivileged.mockReturnValue(true);
      workShiftRepository.find.mockResolvedValue(mockShifts);

      const query = { ...validQuery, requestorId: 'admin-user', userId: 'user-2' };
      await service.getWorkShifts(query);

      expect(workShiftRepository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({ workspaceId: validQuery.workspaceId, userId: 'user-2' }),
        relations: ['attendanceLogs'],
        order: { workDate: 'ASC', startTime: 'ASC' },
      });
    });

    it('should allow admin to fetch all shifts without userId filter', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      calendarCommonService.isPrivileged.mockReturnValue(true);
      workShiftRepository.find.mockResolvedValue(mockShifts);

      await service.getWorkShifts({ ...validQuery, requestorId: 'admin-user' });

      const [findArg] = workShiftRepository.find.mock.calls[0];
      expect(findArg.where).not.toHaveProperty('userId');
    });

    it('should throw INTERNAL_SERVER_ERROR on repository failure', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);
      workShiftRepository.find.mockRejectedValue(new Error('DB error'));

      await expect(service.getWorkShifts(validQuery)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, ...CALENDAR_ERROR.FETCH_SHIFTS_FAILED }),
      );
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
      workShiftRepository.findOne
        .mockResolvedValueOnce(existingShift)
        .mockResolvedValueOnce({ ...existingShift, location: ShiftLocation.WFH });
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);

      const result = await service.updateWorkShift(dto);

      expect(workShiftRepository.update).toHaveBeenCalledWith(
        { id: dto.id, workspaceId: dto.workspaceId, userId: dto.userId },
        { location: dto.location },
      );
      expect(result).toHaveProperty('id', 'shift-1');
      expect(result).toHaveProperty('location', ShiftLocation.WFH);
    });

    it('should throw SHIFT_NOT_FOUND if shift does not exist', async () => {
      workShiftRepository.findOne.mockResolvedValue(null);

      await expect(service.updateWorkShift(dto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.NOT_FOUND, ...CALENDAR_ERROR.SHIFT_NOT_FOUND }),
      );
    });

    it('should throw FORBIDDEN when member tries to update another user\'s shift', async () => {
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.assertSelfOrPrivileged.mockImplementation(() => { throw forbiddenError; });

      const otherUserDto = { ...dto, requestorId: 'user-2' };

      await expect(service.updateWorkShift(otherUserDto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN }),
      );

      expect(workShiftRepository.update).not.toHaveBeenCalled();
    });

    it('should throw FORBIDDEN when someone other than the owner tries to update notes', async () => {
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN); // Even admin cannot update notes
      
      const updateNotesDto = { ...dto, requestorId: 'admin-user', userId: 'user-1', notes: 'New Note' };

      await expect(service.updateWorkShift(updateNotesDto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.FORBIDDEN, message: 'Only the shift owner can update notes' }),
      );

      expect(workShiftRepository.update).not.toHaveBeenCalled();
    });

    it('should successfully update notes if requestor is the owner', async () => {
      workShiftRepository.findOne
        .mockResolvedValueOnce(existingShift)
        .mockResolvedValueOnce({ ...existingShift, notes: 'New Note' });
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);

      const updateNotesDto = { ...dto, requestorId: 'user-1', userId: 'user-1', notes: 'New Note' };
      const result = await service.updateWorkShift(updateNotesDto);

      expect(workShiftRepository.update).toHaveBeenCalledWith(
        { id: dto.id, workspaceId: dto.workspaceId, userId: dto.userId },
        { location: dto.location, notes: 'New Note' },
      );
      expect(result).toHaveProperty('notes', 'New Note');
    });

    it('should allow admin to update another user\'s shift', async () => {
      workShiftRepository.findOne
        .mockResolvedValueOnce(existingShift)
        .mockResolvedValueOnce({ ...existingShift, location: ShiftLocation.WFH });
      calendarCommonService.fetchMember
        .mockResolvedValueOnce(ADMIN)   // requestor
        .mockResolvedValueOnce(MEMBER); // target user

      const adminDto = { ...dto, requestorId: 'admin-user' };
      const result = await service.updateWorkShift(adminDto);

      expect(workShiftRepository.update).toHaveBeenCalled();
      expect(result).toHaveProperty('id', 'shift-1');
    });

    it('should throw BAD_REQUEST if startTime is not strictly UTC', async () => {
      const invalidDto = { ...dto, startTime: '2026-06-20T02:00:00.000' };

      await expect(service.updateWorkShift(invalidDto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.BAD_REQUEST, ...CALENDAR_ERROR.INVALID_TIME_UTC }),
      );
    });

    it('should return existing shift without calling update when no fields change', async () => {
      const emptyDto = { id: 'shift-1', workspaceId: 'ws-1', requestorId: 'user-1', userId: 'user-1' };
      workShiftRepository.findOne.mockResolvedValue(existingShift);

      const result = await service.updateWorkShift(emptyDto);

      expect(workShiftRepository.update).not.toHaveBeenCalled();
      expect(workShiftRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'shift-1', workspaceId: 'ws-1', userId: 'user-1' },
      });
      expect(result).toHaveProperty('id', 'shift-1');
    });

    it('should throw INTERNAL_SERVER_ERROR on repository failure', async () => {
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.update.mockRejectedValue(new Error('DB error'));

      await expect(service.updateWorkShift(dto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, ...CALENDAR_ERROR.UPDATE_SHIFT_FAILED }),
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
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);

      const result = await service.deleteWorkShift(dto);

      expect(workShiftRepository.delete).toHaveBeenCalledWith({
        id: dto.id,
        workspaceId: dto.workspaceId,
        userId: dto.userId,
      });
      expect(result).toEqual('Work shift deleted successfully');
    });

    it('should throw SHIFT_NOT_FOUND if shift does not exist', async () => {
      workShiftRepository.findOne.mockResolvedValue(null);

      await expect(service.deleteWorkShift(dto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.NOT_FOUND, ...CALENDAR_ERROR.SHIFT_NOT_FOUND }),
      );

      expect(workShiftRepository.delete).not.toHaveBeenCalled();
    });

    it('should throw FORBIDDEN when member tries to delete another user\'s shift', async () => {
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.assertSelfOrPrivileged.mockImplementation(() => { throw forbiddenError; });

      const otherUserDto = { ...dto, requestorId: 'user-2' };

      await expect(service.deleteWorkShift(otherUserDto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN }),
      );

      expect(workShiftRepository.delete).not.toHaveBeenCalled();
    });

    it('should allow admin to delete another user\'s shift', async () => {
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);

      const adminDto = { ...dto, requestorId: 'admin-user' };
      const result = await service.deleteWorkShift(adminDto);

      expect(workShiftRepository.delete).toHaveBeenCalled();
      expect(result).toEqual('Work shift deleted successfully');
    });

    it('should throw INTERNAL_SERVER_ERROR on repository failure', async () => {
      workShiftRepository.findOne.mockResolvedValue(existingShift);
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      workShiftRepository.delete.mockRejectedValue(new Error('DB error'));

      await expect(service.deleteWorkShift(dto)).rejects.toMatchObject(
        new RpcException({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, ...CALENDAR_ERROR.DELETE_SHIFT_FAILED }),
      );
    });
  });
});
