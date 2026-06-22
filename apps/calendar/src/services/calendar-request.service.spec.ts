import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { CalendarRequestService } from './calendar-request.service';
import { CalendarRequestEntity } from '../entity/calendar_request.entity';
import { LeaveBalanceEntity } from '../entity/leave_balance.entity';
import { CALENDAR_ERROR, AUTH_ERROR } from '@slack/constants';
import { CalendarRequestType, CalendarRequestStatus, CalendarRequestAction } from '../types/calendar.enum';
import { CalendarCommonService } from './calendar-common.service';

import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { QueueService } from '@slack/queue';

describe('CalendarRequestService', () => {
  let service: CalendarRequestService;
  let requestRepository: any;
  let calendarCommonService: jest.Mocked<Pick<CalendarCommonService, 'fetchMember' | 'isPrivileged' | 'assertPrivileged'>>;
  let policyService: any;
  let queueService: any;
  let manager: any;

  const MEMBER = { id: 'user-1', role: 'member' };
  const ADMIN = { id: 'manager-1', role: 'admin' };
  const forbiddenError = new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN });

  beforeEach(async () => {
    manager = {
      transaction: jest.fn((cb) => cb(manager)),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      merge: jest.fn((_entity, obj, data) => Object.assign(obj, data)),
      createQueryBuilder: jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
        getOne: jest.fn().mockResolvedValue(null),
      }),
    };

    const mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getOne: jest.fn().mockResolvedValue(null),
    };

    requestRepository = {
      manager,
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    calendarCommonService = {
      fetchMember: jest.fn(),
      isPrivileged: jest.fn().mockReturnValue(false),
      assertPrivileged: jest.fn(),
    };

    policyService = {
      getPolicy: jest.fn().mockResolvedValue(null),
    };

    queueService = {
      addJob: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarRequestService,
        {
          provide: getRepositoryToken(CalendarRequestEntity),
          useValue: requestRepository,
        },
        {
          provide: CalendarCommonService,
          useValue: calendarCommonService,
        },
        {
          provide: WorkspaceCalendarPolicyService,
          useValue: policyService,
        },
        {
          provide: QueueService,
          useValue: queueService,
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
      calendarCommonService.fetchMember.mockRejectedValue(forbiddenError);
      await expect(service.createRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN }),
      });
    });

    it('should throw BAD_REQUEST if there is an overlapping request', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.createQueryBuilder().getOne.mockResolvedValueOnce({ id: 'existing-req' });

      await expect(service.createRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.OVERLAPPING_REQUEST.code }),
      });
    });

    it('should throw BAD_REQUEST if LEAVE_PAID and balance is insufficient', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.findOne.mockResolvedValue({ totalPaidLeave: 12, usedPaidLeave: 12 }); // 0 left

      const leavePaidDto = { ...dto, requestType: CalendarRequestType.LEAVE_PAID, durationDays: 1 };

      await expect(service.createRequest(leavePaidDto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.INSUFFICIENT_LEAVE_BALANCE.code }),
      });
    });

    it('should save request successfully if balance is sufficient for LEAVE_PAID', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.findOne.mockResolvedValue({ totalPaidLeave: 12, usedPaidLeave: 5 }); // 7 left
      manager.create.mockReturnValue({ id: 'req-1' });
      manager.save.mockResolvedValue({ id: 'req-1' });

      const leavePaidDto = { ...dto, requestType: CalendarRequestType.LEAVE_PAID, durationDays: 2 };
      const result = await service.createRequest(leavePaidDto);

      expect(manager.create).toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id', 'req-1');
    });

    it('should use DEFAULT_PAID_LEAVE_DAYS if balance record does not exist and no policy', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.findOne.mockResolvedValue(null); // No balance record
      policyService.getPolicy.mockResolvedValue(null);
      manager.create.mockReturnValue({ id: 'req-2' });
      manager.save.mockResolvedValue({ id: 'req-2' });

      const leavePaidDto = { ...dto, requestType: CalendarRequestType.LEAVE_PAID, durationDays: 5 }; // 5 < 12 (default)
      const result = await service.createRequest(leavePaidDto);

      expect(manager.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id', 'req-2');
    });

    it('should use maxPaidLeaveDaysPerYear from policy if balance record does not exist', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.findOne.mockResolvedValue(null); // No balance record
      policyService.getPolicy.mockResolvedValue({ policyData: { maxPaidLeaveDaysPerYear: 20 } });
      manager.create.mockReturnValue({ id: 'req-3' });
      manager.save.mockResolvedValue({ id: 'req-3' });

      const leavePaidDto = { ...dto, requestType: CalendarRequestType.LEAVE_PAID, durationDays: 15 }; // 15 < 20
      const result = await service.createRequest(leavePaidDto);

      expect(policyService.getPolicy).toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id', 'req-3');
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

    it('should throw FORBIDDEN if user tries to update someone else\'s request', async () => {
      manager.findOne.mockResolvedValue({ id: 'req-1', userId: 'user-2', status: CalendarRequestStatus.PENDING });
      await expect(service.updateRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN, code: AUTH_ERROR.FORBIDDEN.code }),
      });
    });

    it('should throw BAD_REQUEST if request is not PENDING', async () => {
      manager.findOne.mockResolvedValue({ id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.APPROVED });
      await expect(service.updateRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.REQUEST_ALREADY_PROCESSED.code }),
      });
    });

    it('should throw BAD_REQUEST if there is an overlapping request during update', async () => {
      manager.findOne.mockResolvedValue({ id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING, startTime: new Date('2026-06-20T00:00:00Z'), endTime: new Date('2026-06-20T10:00:00Z') });
      manager.createQueryBuilder().getOne.mockResolvedValueOnce({ id: 'existing-req' });

      await expect(service.updateRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.OVERLAPPING_REQUEST.code }),
      });
    });

    it('should update request successfully', async () => {
      const mockReq = { id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING, startTime: new Date() };
      manager.findOne.mockResolvedValueOnce(mockReq);
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

    it('should throw FORBIDDEN if user tries to delete someone else\'s request', async () => {
      manager.findOne.mockResolvedValue({ id: 'req-1', userId: 'user-2', status: CalendarRequestStatus.PENDING });
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
      calendarCommonService.fetchMember.mockRejectedValue(forbiddenError);
      await expect(service.getRequests(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN }),
      });
    });

    it('should force targetUserId to userId if member is just a MEMBER', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.isPrivileged.mockReturnValue(false);

      const queryDto = { ...dto, targetUserId: 'some-other-user' };
      const qb = requestRepository.createQueryBuilder();

      await service.getRequests(queryDto);

      // effectiveTargetUserId overrides 'some-other-user' → forced to 'user-1'
      expect(qb.andWhere).toHaveBeenCalledWith('request.userId = :effectiveTargetUserId', { effectiveTargetUserId: 'user-1' });
    });

    it('should allow ADMIN to fetch all requests if targetUserId is omitted', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      calendarCommonService.isPrivileged.mockReturnValue(true);

      const qb = requestRepository.createQueryBuilder();
      await service.getRequests(dto);

      // effectiveTargetUserId is undefined → no userId filter applied
      expect(qb.andWhere).not.toHaveBeenCalledWith('request.userId = :effectiveTargetUserId', expect.anything());
    });

    it('should apply pagination and filters correctly', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      calendarCommonService.isPrivileged.mockReturnValue(true);
      const queryDto = { ...dto, status: CalendarRequestStatus.PENDING, type: CalendarRequestType.LEAVE_PAID, targetUserId: 'user-2' };
      const qb = requestRepository.createQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[{ id: 'req-1' }], 1]);

      const result = await service.getRequests(queryDto);

      expect(qb.andWhere).toHaveBeenCalledWith('request.status = :status', { status: CalendarRequestStatus.PENDING });
      expect(qb.andWhere).toHaveBeenCalledWith('request.requestType = :type', { type: CalendarRequestType.LEAVE_PAID });
      expect(qb.andWhere).toHaveBeenCalledWith('request.userId = :effectiveTargetUserId', { effectiveTargetUserId: 'user-2' });
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result.data).toHaveLength(1);
      expect(result.paging.total).toBe(1);
    });
  });

  describe('reviewRequest', () => {
    const dto: any = {
      id: 'req-1',
      workspaceId: 'workspace-1',
      reviewerId: 'manager-1',
      action: CalendarRequestAction.APPROVE,
      reviewNotes: 'Looks good',
    };

    it('should throw FORBIDDEN if reviewer is just a MEMBER', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.assertPrivileged.mockImplementation(() => { throw forbiddenError; });

      await expect(service.reviewRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN, code: AUTH_ERROR.FORBIDDEN.code }),
      });
    });

    it('should throw BAD_REQUEST if request is not PENDING', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      manager.findOne.mockResolvedValueOnce({ id: 'req-1', status: CalendarRequestStatus.APPROVED });

      await expect(service.reviewRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.REQUEST_ALREADY_PROCESSED.code }),
      });
    });

    it('should correctly REJECT a request', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = { id: 'req-1', status: CalendarRequestStatus.PENDING, requestType: CalendarRequestType.OFF_SHIFT };
      manager.findOne.mockResolvedValueOnce(mockReq);
      manager.save.mockResolvedValueOnce({ ...mockReq, status: CalendarRequestStatus.REJECTED, rejectReason: 'Looks good' });

      const rejectDto = { ...dto, action: CalendarRequestAction.REJECT };
      const result = await service.reviewRequest(rejectDto);

      expect(manager.save).toHaveBeenCalled();
      expect(result.status).toBe(CalendarRequestStatus.REJECTED);
      expect(result.rejectReason).toBe('Looks good');
    });

    it('should correctly APPROVE a LEAVE_PAID request, deduct balance and delete shifts', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = {
        id: 'req-1',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.LEAVE_PAID,
        userId: 'user-1',
        startTime: new Date('2026-06-20T00:00:00Z'),
        endTime: new Date('2026-06-21T00:00:00Z'),
        durationDays: 2,
      };
      const mockBalance = { id: 'bal-1', totalPaidLeave: 12, usedPaidLeave: 5 };

      manager.findOne
        .mockResolvedValueOnce(mockReq)
        .mockResolvedValueOnce(mockBalance);

      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.APPROVED });

      const result = await service.reviewRequest(dto);

      expect(manager.save).toHaveBeenCalledWith(LeaveBalanceEntity, expect.objectContaining({ usedPaidLeave: 7 }));
      expect(manager.createQueryBuilder).toHaveBeenCalled();
      expect(result.status).toBe(CalendarRequestStatus.APPROVED);
    });

    it('should correctly APPROVE a CALENDAR_OPEN_REQUEST and create lock entity', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = {
        id: 'req-2',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.CALENDAR_OPEN_REQUEST,
        userId: 'user-2',
        startTime: new Date('2026-06-20T00:00:00Z'),
      };

      manager.findOne
        .mockResolvedValueOnce(mockReq)
        .mockResolvedValueOnce(null); // lock not found

      const mockLock = { isUnlocked: false };
      manager.create.mockReturnValue(mockLock);
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.APPROVED });

      await service.reviewRequest(dto);

      expect(manager.create).toHaveBeenCalled();
      expect(mockLock.isUnlocked).toBe(true);
      expect(mockLock).toHaveProperty('unlockExpiresAt');
    });
  });

  describe('manualUnlock', () => {
    const dto: any = {
      workspaceId: 'workspace-1',
      reviewerId: 'manager-1',
      targetUserId: 'user-1',
      targetMonth: '2026-07',
      reason: 'Urgent edit',
    };

    it('should throw FORBIDDEN if reviewer is just a MEMBER', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      calendarCommonService.assertPrivileged.mockImplementation(() => { throw forbiddenError; });

      await expect(service.manualUnlock(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN, code: AUTH_ERROR.FORBIDDEN.code }),
      });
    });

    it('should create a new lock entity if none exists and unlock successfully', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      manager.findOne.mockResolvedValueOnce(null); // Lock not found

      const newLock: any = { workspaceId: 'workspace-1', userId: 'user-1', targetMonth: '2026-07' };
      manager.create.mockReturnValue(newLock);
      manager.save.mockResolvedValueOnce(newLock);

      const result = await service.manualUnlock(dto);

      expect(manager.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        targetMonth: '2026-07',
      }));
      expect(newLock).toHaveProperty('isUnlocked', true);
      expect(newLock).toHaveProperty('unlockedBy', 'manager-1');
      expect(newLock).toHaveProperty('unlockReason', 'Urgent edit');
      expect(newLock).toHaveProperty('unlockExpiresAt');
      expect(manager.save).toHaveBeenCalled();
      expect(result).toHaveProperty('success', true);
    });

    it('should update existing lock entity if it exists and unlock successfully', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const existingLock: any = { id: 'lock-1', isUnlocked: false };
      manager.findOne.mockResolvedValueOnce(existingLock);
      manager.save.mockResolvedValueOnce(existingLock);

      const dtoWithoutReason = { ...dto, reason: undefined };
      const result = await service.manualUnlock(dtoWithoutReason);

      expect(manager.create).not.toHaveBeenCalled();
      expect(existingLock).toHaveProperty('isUnlocked', true);
      expect(existingLock).toHaveProperty('unlockedBy', 'manager-1');
      expect(existingLock).toHaveProperty('unlockReason', 'Manual unlock by manager');
      expect(existingLock).toHaveProperty('unlockExpiresAt');
      expect(manager.save).toHaveBeenCalled();
      expect(result).toHaveProperty('success', true);
    });

    it('should throw INTERNAL_SERVER_ERROR if database operation fails', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      manager.findOne.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.manualUnlock(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: CALENDAR_ERROR.MANUAL_UNLOCK_FAILED.code }),
      });
    });
  });
});
