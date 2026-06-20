import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
import { RpcException, ClientProxy } from '@nestjs/microservices';
import { CalendarRequestService } from './calendar-request.service';
import { CalendarRequestEntity } from '../entity/calendar_request.entity';
import { LeaveBalanceEntity } from '../entity/leave_balance.entity';
import { NAME_SERVICE_TCP, WORKSPACE_MESSAGE_PATTERNS, CALENDAR_ERROR, DEFAULT_PAID_LEAVE_DAYS, WorkspaceRoleEnum } from '@slack/constants';
import { CalendarRequestType, CalendarRequestStatus } from '../types/calendar.enum';
import { of } from 'rxjs';

describe('CalendarRequestService', () => {
  let service: CalendarRequestService;
  let requestRepository: any;
  let leaveBalanceRepository: any;
  let workspaceClient: any;
  let manager: any;

  beforeEach(async () => {
    manager = {
      transaction: jest.fn((cb) => cb(manager)),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      merge: jest.fn((entity, obj, data) => Object.assign(obj, data)),
    };

    const mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    requestRepository = {
      manager,
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    leaveBalanceRepository = {
      findOne: jest.fn(),
    };

    workspaceClient = {
      send: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarRequestService,
        {
          provide: getRepositoryToken(CalendarRequestEntity),
          useValue: requestRepository,
        },
        {
          provide: getRepositoryToken(LeaveBalanceEntity),
          useValue: leaveBalanceRepository,
        },
        {
          provide: NAME_SERVICE_TCP.WORKSPACE_SERVICE,
          useValue: workspaceClient,
        },
      ],
    }).compile();

    service = module.get<CalendarRequestService>(CalendarRequestService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createRequest', () => {
    const dto: any = {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      requestType: CalendarRequestType.OFF_SHIFT,
      startTime: '2026-06-20T00:00:00Z',
      endTime: '2026-06-20T10:00:00Z',
      reason: 'Sick',
    };

    it('should throw FORBIDDEN if user is not a workspace member', async () => {
      workspaceClient.send.mockReturnValue(of(null));
      await expect(service.createRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN }),
      });
    });

    it('should throw BAD_REQUEST if LEAVE_PAID and balance is insufficient', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'user-1', role: WorkspaceRoleEnum.MEMBER }));
      manager.findOne.mockResolvedValue({ totalPaidLeave: 12, usedPaidLeave: 12 }); // 0 left
      
      const leavePaidDto = { ...dto, requestType: CalendarRequestType.LEAVE_PAID, durationDays: 1 };
      
      await expect(service.createRequest(leavePaidDto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.INSUFFICIENT_LEAVE_BALANCE.code }),
      });
    });

    it('should save request successfully if balance is sufficient for LEAVE_PAID', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'user-1', role: WorkspaceRoleEnum.MEMBER }));
      manager.findOne.mockResolvedValue({ totalPaidLeave: 12, usedPaidLeave: 5 }); // 7 left
      manager.create.mockReturnValue({ id: 'req-1' });
      manager.save.mockResolvedValue({ id: 'req-1' });

      const leavePaidDto = { ...dto, requestType: CalendarRequestType.LEAVE_PAID, durationDays: 2 };
      const result = await service.createRequest(leavePaidDto);

      expect(manager.create).toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id', 'req-1');
    });

    it('should use DEFAULT_PAID_LEAVE_DAYS if balance record does not exist', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'user-1', role: WorkspaceRoleEnum.MEMBER }));
      manager.findOne.mockResolvedValue(null); // No balance record
      manager.create.mockReturnValue({ id: 'req-2' });
      manager.save.mockResolvedValue({ id: 'req-2' });

      const leavePaidDto = { ...dto, requestType: CalendarRequestType.LEAVE_PAID, durationDays: 5 }; // 5 < 12 (default)
      const result = await service.createRequest(leavePaidDto);

      expect(manager.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id', 'req-2');
    });
  });

  describe('updateRequest', () => {
    const dto: any = {
      id: 'req-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      reason: 'Updated reason',
    };

    it('should throw NOT_FOUND if request does not exist', async () => {
      manager.findOne.mockResolvedValue(null);
      await expect(service.updateRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.NOT_FOUND }),
      });
    });

    it('should throw FORBIDDEN if user tries to update someone else request', async () => {
      manager.findOne.mockResolvedValue({ id: 'req-1', userId: 'user-2' }); // Owned by user-2
      await expect(service.updateRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN, code: CALENDAR_ERROR.REQUEST_FORBIDDEN_ACTION.code }),
      });
    });

    it('should throw BAD_REQUEST if request is not PENDING', async () => {
      manager.findOne.mockResolvedValue({ id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.APPROVED });
      await expect(service.updateRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.REQUEST_NOT_PENDING.code }),
      });
    });

    it('should update request successfully', async () => {
      const mockReq = { id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING, startTime: new Date() };
      manager.findOne.mockResolvedValueOnce(mockReq); // Request lookup
      manager.save.mockResolvedValue({ ...mockReq, reason: 'Updated reason' });

      const result = await service.updateRequest(dto);

      expect(manager.merge).toHaveBeenCalledWith(CalendarRequestEntity, mockReq, expect.objectContaining({ reason: 'Updated reason' }));
      expect(manager.save).toHaveBeenCalled();
      expect(result.reason).toBe('Updated reason');
    });
  });

  describe('deleteRequest', () => {
    const dto: any = {
      id: 'req-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    };

    it('should throw NOT_FOUND if request does not exist', async () => {
      manager.findOne.mockResolvedValue(null);
      await expect(service.deleteRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.NOT_FOUND }),
      });
    });

    it('should throw FORBIDDEN if user tries to delete someone else request', async () => {
      manager.findOne.mockResolvedValue({ id: 'req-1', userId: 'user-2' });
      await expect(service.deleteRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN }),
      });
    });

    it('should delete request successfully if PENDING', async () => {
      const mockReq = { id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING };
      manager.findOne.mockResolvedValue(mockReq);
      manager.remove.mockResolvedValue(true);

      const result = await service.deleteRequest(dto);

      expect(manager.remove).toHaveBeenCalledWith(CalendarRequestEntity, mockReq);
      expect(result).toHaveProperty('success', true);
    });
  });

  describe('getRequests', () => {
    const dto: any = {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      page: 1,
      limit: 10,
    };

    it('should throw FORBIDDEN if not a workspace member', async () => {
      workspaceClient.send.mockReturnValue(of(null));
      await expect(service.getRequests(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN }),
      });
    });

    it('should force targetUserId to userId if member is just a MEMBER', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'user-1', role: WorkspaceRoleEnum.MEMBER }));
      
      const queryDto = { ...dto, targetUserId: 'some-other-user' };
      const qb = requestRepository.createQueryBuilder();
      
      await service.getRequests(queryDto);
      
      // Should override 'some-other-user' with 'user-1'
      expect(qb.andWhere).toHaveBeenCalledWith('request.userId = :actualTargetUserId', { actualTargetUserId: 'user-1' });
    });

    it('should allow ADMIN to fetch all requests if targetUserId is omitted', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'user-1', role: WorkspaceRoleEnum.ADMIN }));
      
      const qb = requestRepository.createQueryBuilder();
      await service.getRequests(dto);
      
      // actualTargetUserId should be undefined, so andWhere for userId should not be called
      expect(qb.andWhere).not.toHaveBeenCalledWith('request.userId = :actualTargetUserId', expect.anything());
    });

    it('should apply pagination and filters correctly', async () => {
      workspaceClient.send.mockReturnValue(of({ id: 'user-1', role: WorkspaceRoleEnum.OWNER }));
      const queryDto = { ...dto, status: CalendarRequestStatus.PENDING, type: CalendarRequestType.LEAVE_PAID, targetUserId: 'user-2' };
      const qb = requestRepository.createQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[{ id: 'req-1' }], 1]);

      const result = await service.getRequests(queryDto);

      expect(qb.andWhere).toHaveBeenCalledWith('request.status = :status', { status: CalendarRequestStatus.PENDING });
      expect(qb.andWhere).toHaveBeenCalledWith('request.requestType = :type', { type: CalendarRequestType.LEAVE_PAID });
      expect(qb.andWhere).toHaveBeenCalledWith('request.userId = :actualTargetUserId', { actualTargetUserId: 'user-2' });
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result.data).toHaveLength(1);
      expect(result.paging.total).toBe(1);
    });
  });
});
