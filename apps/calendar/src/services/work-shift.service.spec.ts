import { Test, TestingModule } from '@nestjs/testing';
import { WorkShiftService } from './work-shift.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkShiftEntity } from '../entity/work_shift.entity';
import { NAME_SERVICE_TCP, WORKSPACE_MESSAGE_PATTERNS } from '@slack/constants';
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ShiftLocation } from '../types/calendar.enum';
import { of } from 'rxjs';

describe('WorkShiftService', () => {
  let service: WorkShiftService;
  let workShiftRepository: any;
  let workspaceClient: any;

  beforeEach(async () => {
    workShiftRepository = {
      upsert: jest.fn().mockResolvedValue({}),
      find: jest.fn(),
    };

    workspaceClient = {
      send: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkShiftService,
        {
          provide: getRepositoryToken(WorkShiftEntity),
          useValue: workShiftRepository,
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

      const result = await service.bulkRegisterShifts(validDto);

      expect(workspaceClient.send).toHaveBeenCalledWith(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
        workspaceId: validDto.workspaceId,
        userId: validDto.userId,
      });

      expect(workShiftRepository.upsert).toHaveBeenCalled();
      expect(result).toBe('Successfully registered 1 shifts.');
    });

    it('should throw FORBIDDEN exception if user is not a member', async () => {
      workspaceClient.send.mockReturnValue(of(null)); // Not a member

      await expect(service.bulkRegisterShifts(validDto)).rejects.toMatchObject(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          message: 'User is not a member of this workspace',
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
          message: 'Strict UTC Validation Failed: startTime and endTime must be valid UTC strings ending with Z',
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
          message: 'Failed to bulk register shifts',
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
          // Since Between is a function returning a FindOperator, we can match it generally
          workDate: expect.any(Object),
        }),
        order: { workDate: 'ASC', startTime: 'ASC' },
      });

      expect(result).toBeInstanceOf(Array);
      expect(result[0]).toHaveProperty('id', 'shift-1');
      // Should not have raw entity properties or methods if any, but since we used plainToInstance, it's mapped.
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
          message: 'Failed to fetch work shifts',
        }),
      );
    });
  });
});
