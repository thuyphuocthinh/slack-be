import { Test, TestingModule } from '@nestjs/testing';
import { WorkShiftService } from './work-shift.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { NAME_SERVICE_TCP, WORKSPACE_MESSAGE_PATTERNS, CALENDAR_ERROR } from '@slack/constants';
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ShiftLocation } from '../types/calendar.enum';
import { of } from 'rxjs';

import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';

describe('WorkShiftService', () => {
  let service: WorkShiftService;
  let policyService: any;
  let workShiftRepository: any;
  let workspaceClient: any;

  beforeEach(async () => {
    workShiftRepository = {
      upsert: jest.fn().mockResolvedValue({}),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    workspaceClient = {
      send: jest.fn(),
    };

    policyService = {
      validateShifts: jest.fn().mockResolvedValue(undefined),
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
          provide: NAME_SERVICE_TCP.WORKSPACE_SERVICE,
          useValue: workspaceClient,
        },
      ],
    }).compile();

    service = module.get<WorkShiftService>(WorkShiftService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('bulkRegisterShifts', () => {
    const validDto = {
      workspaceId: 'workspace-1',
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

    it('should successfully register shifts if user is a valid member and inputs are correct', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'member-1' })); // User is a member
      workShiftRepository.find.mockResolvedValue([]); // Mock returning mapped DTOs
      const result = await service.bulkRegisterShifts(validDto);

      expect(workspaceClient.send).toHaveBeenCalledWith(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
        workspaceId: validDto.workspaceId,
        userId: validDto.userId,
      });

      expect(workShiftRepository.upsert).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Array);
    });

    it('should throw FORBIDDEN exception if user is not a member', async () => {
      workspaceClient.send.mockReturnValue(of(null)); // Not a member

      await expect(service.bulkRegisterShifts(validDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...CALENDAR_ERROR.NOT_WORKSPACE_MEMBER,
        }),
      );

      expect(workShiftRepository.upsert).not.toHaveBeenCalled();
    });

    it('should throw BAD_REQUEST exception if shift times are not strictly UTC ending in Z', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'member-1' }));

      const invalidDto = {
        ...validDto,
        shifts: [
          {
            workDate: '2026-06-20',
            startTime: '2026-06-20T02:00:00.000', // Missing Z
            endTime: '2026-06-20T11:00:00.000Z',
          },
        ],
      };

      await expect(service.bulkRegisterShifts(invalidDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...CALENDAR_ERROR.INVALID_TIME_UTC,
        }),
      );

      expect(workShiftRepository.upsert).not.toHaveBeenCalled();
    });

    it('should handle internal repository errors', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'member-1' }));
      workShiftRepository.upsert.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.bulkRegisterShifts(validDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.BULK_REGISTER_FAILED,
        }),
      );
    });
  });
  describe('getWorkShifts', () => {
    const validQuery = {
      workspaceId: 'workspace-1',
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

    it('should successfully fetch and map shifts without userId filter', async () => {
      workShiftRepository.find.mockResolvedValue(mockShifts);

      const result = await service.getWorkShifts(validQuery);

      expect(workShiftRepository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          workspaceId: validQuery.workspaceId,
          workDate: expect.any(Object),
        }),
        order: { workDate: 'ASC', startTime: 'ASC' },
      });

      expect(result).toBeInstanceOf(Array);
      expect(result[0]).toHaveProperty('id', 'shift-1');
    });

    it('should successfully fetch with userId filter if provided', async () => {
      workShiftRepository.find.mockResolvedValue(mockShifts);

      const queryWithUser = { ...validQuery, userId: 'user-2' };
      await service.getWorkShifts(queryWithUser);

      expect(workShiftRepository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          workspaceId: validQuery.workspaceId,
          userId: 'user-2',
        }),
        order: { workDate: 'ASC', startTime: 'ASC' },
      });
    });

    it('should handle internal repository errors', async () => {
      workShiftRepository.find.mockRejectedValue(new Error('DB error'));

      await expect(service.getWorkShifts(validQuery)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.FETCH_SHIFTS_FAILED,
        }),
      );
    });
  });

  describe('updateWorkShift', () => {
    const dto = {
      id: 'shift-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      location: ShiftLocation.WFH,
    };

    it('should successfully update a work shift', async () => {
      workShiftRepository.update.mockResolvedValue({ affected: 1 });
      workShiftRepository.findOne.mockResolvedValue({ id: 'shift-1', location: ShiftLocation.WFH });
      workspaceClient.send.mockReturnValue(of({ id: 'member-1', employmentType: 'FULLTIME' }));

      const result = await service.updateWorkShift(dto);

      expect(workShiftRepository.update).toHaveBeenCalledWith(
        { id: dto.id, workspaceId: dto.workspaceId, userId: dto.userId },
        { location: dto.location }
      );
      expect(result).toHaveProperty('id', 'shift-1');
      expect(result).toHaveProperty('location', ShiftLocation.WFH);
    });

    it('should throw SHIFT_NOT_FOUND if affected is 0', async () => {
      workShiftRepository.update.mockResolvedValue({ affected: 0 });

      await expect(service.updateWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.SHIFT_NOT_FOUND,
        }),
      );
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

    it('should handle empty update object by just checking existence', async () => {
      const emptyDto = { id: 'shift-1', workspaceId: 'ws-1', userId: 'user-1' };
      workShiftRepository.findOne.mockResolvedValue({ id: 'shift-1' });

      const result = await service.updateWorkShift(emptyDto);

      expect(workShiftRepository.update).not.toHaveBeenCalled();
      expect(workShiftRepository.findOne).toHaveBeenCalledWith({ where: emptyDto });
      expect(result).toHaveProperty('id', 'shift-1');
    });

    it('should handle internal errors', async () => {
      workShiftRepository.findOne.mockResolvedValue({ id: 'shift-1', location: ShiftLocation.WFH });
      workspaceClient.send.mockReturnValue(of({ id: 'member-1', employmentType: 'FULLTIME' }));
      workShiftRepository.update.mockRejectedValue(new Error('DB error'));

      await expect(service.updateWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.UPDATE_SHIFT_FAILED,
        }),
      );
    });
  });

  describe('deleteWorkShift', () => {
    const dto = {
      id: 'shift-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    };

    it('should successfully delete a work shift', async () => {
      workShiftRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deleteWorkShift(dto);

      expect(workShiftRepository.delete).toHaveBeenCalledWith(dto);
      expect(result).toEqual('Work shift deleted successfully');
    });

    it('should throw SHIFT_NOT_FOUND if affected is 0', async () => {
      workShiftRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.deleteWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...CALENDAR_ERROR.SHIFT_NOT_FOUND,
        }),
      );
    });

    it('should handle internal errors', async () => {
      workShiftRepository.delete.mockRejectedValue(new Error('DB error'));

      await expect(service.deleteWorkShift(dto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.DELETE_SHIFT_FAILED,
        }),
      );
    });
  });
});
