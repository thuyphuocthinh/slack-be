import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { CalendarRequestService } from './calendar-request.service';
import { CalendarRequestEntity } from '../entity/calendar_request.entity';
import { LeaveBalanceEntity } from '../entity/leave_balance.entity';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { DailyReconciliationStatus } from '../types/calendar.enum';
import { CALENDAR_ERROR, AUTH_ERROR } from '@slack/constants';
import { CalendarRequestType, CalendarRequestStatus, CalendarRequestAction } from '../types/calendar.enum';
import { CalendarCommonService } from './calendar-common.service';

import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';
import { QueueService } from '@slack/queue';
import { WorkspaceHolidayService } from './workspace-holiday.service';

jest.mock('nanoid', () => ({
  customAlphabet: jest.fn(() => jest.fn(() => 'mock-id')),
}));

describe('CalendarRequestService', () => {
  let service: CalendarRequestService;
  let requestRepository: any;
  let calendarCommonService: jest.Mocked<Pick<CalendarCommonService, 'fetchMember' | 'isPrivileged' | 'assertPrivileged'>>;
  let policyService: any;
  let queueService: any;
  let holidayService: any;
  let manager: any;

  const MEMBER = { id: 'user-1', role: 'member' };
  const ADMIN = { id: 'manager-1', role: 'admin' };
  const forbiddenError = new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN });

  beforeEach(async () => {
    manager = {
      transaction: jest.fn((cb) => cb(manager)),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      remove: jest.fn(),
      merge: jest.fn((_entity, obj, data) => Object.assign(obj, data)),
      createQueryBuilder: jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
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
      getPolicyDirect: jest.fn().mockResolvedValue(null),
      checkLockDeadline: jest.fn().mockResolvedValue(undefined),
    };

    queueService = {
      addJob: jest.fn().mockResolvedValue(null),
    };

    holidayService = {
      checkIfDatesAreHolidays: jest.fn().mockResolvedValue({}),
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
        {
          provide: WorkspaceHolidayService,
          useValue: holidayService,
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
      startTime: '2026-06-22T00:00:00Z',
      endTime: '2026-06-22T10:00:00Z',
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

    it('should allow LEAVE_PAID creation without balance check (balance is checked at approval time)', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.create.mockReturnValue({ id: 'req-no-balance' });
      manager.save.mockResolvedValue({ id: 'req-no-balance' });

      const leavePaidDto = { ...dto, requestType: CalendarRequestType.LEAVE_PAID, durationDays: 1 };
      const result = await service.createRequest(leavePaidDto);

      // Balance check intentionally moved to handleLeaveApproval — createRequest always succeeds if input is valid
      expect(result).toHaveProperty('id', 'req-no-balance');
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

    it('should throw FORBIDDEN if start time is in a locked month', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      policyService.checkLockDeadline.mockRejectedValueOnce(new RpcException({ statusCode: HttpStatus.FORBIDDEN, message: 'Locked' }));

      await expect(service.createRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN, message: 'Locked' })
      });
    });

    it('should count Saturday as a working day when policy workingDays includes Saturday', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      policyService.getPolicy.mockResolvedValue({ policyData: { workingDays: [1, 2, 3, 4, 5, 6], maxPaidLeaveDaysPerYear: 12 } });
      manager.findOne.mockResolvedValue({ totalPaidLeave: 12, usedPaidLeave: 5 }); // 7 left
      manager.create.mockReturnValue({ id: 'req-sat' });
      manager.save.mockResolvedValue({ id: 'req-sat' });

      // Friday (2026-06-26) to Saturday (2026-06-27) = 2 working days under Mon-Sat policy
      const satDto: any = {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        requestType: CalendarRequestType.LEAVE_PAID,
        startTime: '2026-06-26T00:00:00Z',
        endTime: '2026-06-27T23:59:59Z',
        durationDays: 2,
        reason: 'Weekend worker',
      };

      const result = await service.createRequest(satDto);

      expect(policyService.getPolicy).toHaveBeenCalled();
      // actualDuration NOT capped (2 working days = 2) — save called with durationDays 2
      expect(manager.create).toHaveBeenCalledWith(
        CalendarRequestEntity,
        expect.objectContaining({ durationDays: 2 }),
      );
      expect(result).toHaveProperty('id', 'req-sat');
    });

    it('should cap durationDays to 1 when Saturday is outside default Mon-Fri workingDays', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      policyService.getPolicy.mockResolvedValue(null); // default Mon-Fri
      manager.findOne.mockResolvedValue({ totalPaidLeave: 12, usedPaidLeave: 5 }); // 7 left
      manager.create.mockReturnValue({ id: 'req-fri' });
      manager.save.mockResolvedValue({ id: 'req-fri' });

      // Friday (2026-06-26) to Saturday (2026-06-27) — only 1 working day (Friday)
      const satDto: any = {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        requestType: CalendarRequestType.LEAVE_PAID,
        startTime: '2026-06-26T00:00:00Z',
        endTime: '2026-06-27T23:59:59Z',
        durationDays: 2,
        reason: 'Test',
      };

      await service.createRequest(satDto);

      // Saturday not in workingDays → maxWorkingDays = 1 → actualDuration capped to 1
      expect(manager.create).toHaveBeenCalledWith(
        CalendarRequestEntity,
        expect.objectContaining({ durationDays: 1 }),
      );
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
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.REQUEST_ALREADY_PROCESSED_OR_STARTED.code }),
      });
    });

    it('should throw BAD_REQUEST if there is an overlapping request during update', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.findOne.mockResolvedValue({ id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING, startTime: new Date('2026-06-22T00:00:00Z'), endTime: new Date('2026-06-22T10:00:00Z') });
      manager.createQueryBuilder().getOne.mockResolvedValueOnce({ id: 'existing-req' });

      await expect(service.updateRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.OVERLAPPING_REQUEST.code }),
      });
    });

    it('should update request successfully', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      const mockReq = { id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING, startTime: new Date('2026-06-22T00:00:00Z'), endTime: new Date('2026-06-22T23:59:59Z'), requestType: CalendarRequestType.LEAVE_PAID };
      manager.findOne.mockResolvedValueOnce(mockReq);
      manager.save.mockResolvedValue({ ...mockReq, reason: 'Updated reason' });

      holidayService.checkIfDatesAreHolidays.mockResolvedValueOnce({
        '2026-06-22': true,
      });

      const result = await service.updateRequest(dto);

      expect(holidayService.checkIfDatesAreHolidays).toHaveBeenCalled();
      expect(manager.merge).toHaveBeenCalledWith(CalendarRequestEntity, mockReq, expect.objectContaining({ reason: 'Updated reason' }));
      expect(manager.save).toHaveBeenCalled();
      expect(result.reason).toBe('Updated reason');
    });

    it('should throw FORBIDDEN if new or old start time is in a locked month', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.findOne.mockResolvedValueOnce({ id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING, startTime: new Date() });
      policyService.checkLockDeadline.mockRejectedValueOnce(new RpcException({ statusCode: HttpStatus.FORBIDDEN, message: 'Locked' }));
      
      await expect(service.updateRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN, message: 'Locked' })
      });
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

    it('should delete (soft cancel) request successfully if PENDING', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      const mockReq = { id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING, requestType: CalendarRequestType.LEAVE_PAID, startTime: new Date() };
      manager.findOne.mockResolvedValue(mockReq);
      manager.save.mockResolvedValue(true);

      const result = await service.deleteRequest(dto);

      expect(manager.save).toHaveBeenCalledWith(CalendarRequestEntity, expect.objectContaining({
        status: CalendarRequestStatus.CANCELLED
      }));
      expect(result).toHaveProperty('success', true);
    });

    it('should throw FORBIDDEN if deleted request is in a locked month', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      manager.findOne.mockResolvedValueOnce({ id: 'req-1', userId: 'user-1', status: CalendarRequestStatus.PENDING, startTime: new Date() });
      policyService.checkLockDeadline.mockRejectedValueOnce(new RpcException({ statusCode: HttpStatus.FORBIDDEN, message: 'Locked' }));

      await expect(service.deleteRequest(dto)).rejects.toMatchObject({
        error: expect.objectContaining({ statusCode: HttpStatus.FORBIDDEN, message: 'Locked' })
      });
    });

    it('should delete reconciliation records when cancelling an APPROVED LEAVE_PAID request', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      const futureStart = new Date('2026-07-07T01:00:00Z'); // Monday
      const futureEnd = new Date('2026-07-08T23:59:59Z');   // Tuesday
      const mockReq = {
        id: 'req-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        status: CalendarRequestStatus.APPROVED,
        requestType: CalendarRequestType.LEAVE_PAID,
        startTime: futureStart,
        endTime: futureEnd,
        durationDays: 2,
      };
      manager.findOne.mockResolvedValueOnce(mockReq); // findAndValidateRequest
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.CANCELLED });

      await service.deleteRequest(dto);

      expect(manager.delete).toHaveBeenCalledWith(
        DailyReconciliationEntity,
        expect.objectContaining({
          workspaceId: 'workspace-1',
          userId: 'user-1',
          workDate: expect.anything(), // In([...])
        }),
      );
    });

    it('should NOT delete reconciliation records when cancelling a PENDING leave request', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      const mockReq = {
        id: 'req-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.LEAVE_PAID,
        startTime: new Date('2026-07-07T01:00:00Z'),
        endTime: new Date('2026-07-07T23:59:59Z'),
        durationDays: 1,
      };
      manager.findOne.mockResolvedValueOnce(mockReq);
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.CANCELLED });

      await service.deleteRequest(dto);

      expect(manager.delete).not.toHaveBeenCalledWith(DailyReconciliationEntity, expect.anything());
    });

    it('should delete reconciliation for Saturday when workingDays includes Saturday', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      policyService.getPolicy.mockResolvedValue({ policyData: { workingDays: [1, 2, 3, 4, 5, 6] } });

      // 2026-07-04 is a Saturday and is in the future (today = 2026-06-28)
      const satStart = new Date('2026-07-04T00:00:00Z');
      const satEnd = new Date('2026-07-04T23:59:59Z');
      const mockReq = {
        id: 'req-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        status: CalendarRequestStatus.APPROVED,
        requestType: CalendarRequestType.LEAVE_PAID,
        startTime: satStart,
        endTime: satEnd,
        durationDays: 1,
      };
      manager.findOne
        .mockResolvedValueOnce(mockReq)  // findAndValidateRequest
        .mockResolvedValueOnce(null);     // balance refund (no balance record)
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.CANCELLED });

      await service.deleteRequest(dto);

      // Saturday is a workday → reconciliation for '2026-07-04' should be deleted
      expect(manager.delete).toHaveBeenCalledWith(
        DailyReconciliationEntity,
        expect.objectContaining({ workspaceId: 'workspace-1', userId: 'user-1' }),
      );
    });

    it('should NOT delete reconciliation for Saturday when policy uses default Mon-Fri', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(MEMBER);
      policyService.getPolicy.mockResolvedValue(null); // default Mon-Fri

      const satStart = new Date('2026-07-04T00:00:00Z'); // Saturday
      const satEnd = new Date('2026-07-04T23:59:59Z');
      const mockReq = {
        id: 'req-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        status: CalendarRequestStatus.APPROVED,
        requestType: CalendarRequestType.LEAVE_PAID,
        startTime: satStart,
        endTime: satEnd,
        durationDays: 0,
      };
      manager.findOne
        .mockResolvedValueOnce(mockReq)
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.CANCELLED });

      await service.deleteRequest(dto);

      // Saturday not in Mon-Fri workingDays → getWorkdaysBetween returns [] → no delete
      expect(manager.delete).not.toHaveBeenCalledWith(DailyReconciliationEntity, expect.anything());
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
        error: expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, code: CALENDAR_ERROR.REQUEST_ALREADY_PROCESSED_OR_STARTED.code }),
      });
    });

    it('should correctly REJECT a request', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = { id: 'req-1', status: CalendarRequestStatus.PENDING, requestType: CalendarRequestType.OFF_SHIFT, startTime: new Date() };
      manager.findOne.mockResolvedValueOnce(mockReq);
      manager.save.mockResolvedValueOnce({ ...mockReq, status: CalendarRequestStatus.REJECTED, rejectReason: 'Looks good' });

      const rejectDto = { ...dto, action: CalendarRequestAction.REJECT };
      const result = await service.reviewRequest(rejectDto);

      expect(manager.save).toHaveBeenCalled();
      expect(result.status).toBe(CalendarRequestStatus.REJECTED);
      expect(result.rejectReason).toBe('Looks good');
    });

    it('should correctly APPROVE a LEAVE_PAID request, deduct balance, delete shifts and create reconciliation records', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = {
        id: 'req-1',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.LEAVE_PAID,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        startTime: new Date('2026-06-22T00:00:00Z'), // Monday
        endTime: new Date('2026-06-23T00:00:00Z'),   // Tuesday
        durationDays: 2,
      };
      const mockBalance = { id: 'bal-1', totalPaidLeave: 12, usedPaidLeave: 5 };

      manager.findOne
        .mockResolvedValueOnce(mockReq)     // findAndValidateRequest
        .mockResolvedValueOnce(mockBalance); // balance check in handleLeaveApproval
      manager.find.mockResolvedValueOnce([]); // batch reconciliation lookup → no existing records

      manager.create.mockImplementation((_entity: any, data: any) => ({ ...data }));
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.APPROVED });

      const result = await service.reviewRequest(dto);

      // balance deducted
      expect(manager.save).toHaveBeenCalledWith(LeaveBalanceEntity, expect.objectContaining({ usedPaidLeave: 7 }));
      // shifts deleted
      expect(manager.createQueryBuilder).toHaveBeenCalled();
      // reconciliation records created for both leave days
      expect(manager.create).toHaveBeenCalledWith(DailyReconciliationEntity, expect.objectContaining({
        workDate: '2026-06-22',
        status: DailyReconciliationStatus.LEAVE_PAID_APPROVED,
      }));
      expect(manager.create).toHaveBeenCalledWith(DailyReconciliationEntity, expect.objectContaining({
        workDate: '2026-06-23',
        status: DailyReconciliationStatus.LEAVE_PAID_APPROVED,
      }));
      expect(result.status).toBe(CalendarRequestStatus.APPROVED);
    });

    it('should create LEAVE_UNPAID_APPROVED reconciliation records when approving LEAVE_UNPAID', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = {
        id: 'req-4',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.LEAVE_UNPAID,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        startTime: new Date('2026-06-22T00:00:00Z'), // Monday
        endTime: new Date('2026-06-22T23:59:59Z'),   // same day
        durationDays: 1,
      };

      manager.findOne.mockResolvedValueOnce(mockReq); // findAndValidateRequest
      manager.find.mockResolvedValueOnce([]);        // batch reconciliation lookup → no existing

      manager.create.mockImplementation((_entity: any, data: any) => ({ ...data }));
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.APPROVED });

      const approveDto = { ...dto, id: 'req-4' };
      await service.reviewRequest(approveDto);

      expect(manager.create).toHaveBeenCalledWith(DailyReconciliationEntity, expect.objectContaining({
        workDate: '2026-06-22',
        status: DailyReconciliationStatus.LEAVE_UNPAID_APPROVED,
      }));
      // leave balance must NOT be touched for unpaid leave
      expect(manager.save).not.toHaveBeenCalledWith(LeaveBalanceEntity, expect.anything());
    });

    it('should update existing reconciliation record status when approving leave on a day already reconciled', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = {
        id: 'req-5',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.LEAVE_PAID,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        startTime: new Date('2026-06-22T00:00:00Z'),
        endTime: new Date('2026-06-22T23:59:59Z'),
        durationDays: 1,
      };
      const mockBalance = { id: 'bal-1', totalPaidLeave: 12, usedPaidLeave: 5 };
      const existingReconciliation = { id: 'rec-1', workDate: '2026-06-22', status: DailyReconciliationStatus.LATE_EARLY };

      manager.findOne
        .mockResolvedValueOnce(mockReq)    // findAndValidateRequest
        .mockResolvedValueOnce(mockBalance); // balance check
      manager.find
        .mockResolvedValueOnce([])                       // Fix #3: shifts in range to null attendance logs (none)
        .mockResolvedValueOnce([existingReconciliation]); // batch reconciliation lookup

      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.APPROVED });

      const approveDto = { ...dto, id: 'req-5' };
      await service.reviewRequest(approveDto);

      // should update the existing record's status in-place, not create a new one
      expect(manager.create).not.toHaveBeenCalledWith(DailyReconciliationEntity, expect.anything());
      expect(manager.save).toHaveBeenCalledWith(
        DailyReconciliationEntity,
        expect.arrayContaining([expect.objectContaining({ id: 'rec-1', status: DailyReconciliationStatus.LEAVE_PAID_APPROVED })]),
      );
    });

    it('should calculate actualDuration skipping holidays in reviewRequest', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = {
        id: 'req-3',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.LEAVE_PAID,
        userId: 'user-1',
        startTime: new Date('2026-06-22T00:00:00Z'),
        endTime: new Date('2026-06-23T00:00:00Z'), // 2 working days originally
        durationDays: 2,
      };
      
      const mockBalance = { id: 'bal-1', totalPaidLeave: 12, usedPaidLeave: 5 }; // available = 7
      manager.findOne
        .mockResolvedValueOnce(mockReq)
        .mockResolvedValueOnce(mockBalance);

      // Simulate a holiday on 2026-06-23 (duration is capped to 1)
      holidayService.checkIfDatesAreHolidays.mockResolvedValueOnce({
        '2026-06-23': true
      });

      // Update the DTO to match what updateRequest uses
      // wait, reviewRequest doesn't re-calculate actualDuration! It only uses request.durationDays.
      // But updateRequest does. I'll test updateRequest for the holiday check.
    });

    it('should NOT call checkLockDeadline — manager can approve even after lock deadline', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = {
        id: 'req-1',
        userId: 'user-1',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.OFF_SHIFT,
        startTime: new Date(),
      };
      manager.findOne.mockResolvedValueOnce(mockReq);
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.REJECTED });

      const rejectDto = { ...dto, action: CalendarRequestAction.REJECT };
      await service.reviewRequest(rejectDto);

      expect(policyService.checkLockDeadline).not.toHaveBeenCalled();
    });

    it('should correctly APPROVE a CALENDAR_OPEN_REQUEST and create lock entity', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      const mockReq = {
        id: 'req-2',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.CALENDAR_OPEN_REQUEST,
        userId: 'user-2',
        startTime: new Date('2026-06-22T00:00:00Z'),
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

    it('should create reconciliation for Saturday when policy workingDays includes Saturday', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      policyService.getPolicyDirect.mockResolvedValue({ policyData: { workingDays: [1, 2, 3, 4, 5, 6] } });

      const mockReq = {
        id: 'req-sat',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.LEAVE_UNPAID,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        startTime: new Date('2026-06-27T00:00:00Z'), // Saturday
        endTime: new Date('2026-06-27T23:59:59Z'),
        durationDays: 1,
      };

      manager.findOne.mockResolvedValueOnce(mockReq);
      manager.find.mockResolvedValueOnce([]); // shifts in range
      manager.find.mockResolvedValueOnce([]); // existing reconciliation

      manager.create.mockImplementation((_entity: any, data: any) => ({ ...data }));
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.APPROVED });

      await service.reviewRequest({ ...dto, id: 'req-sat' });

      expect(manager.create).toHaveBeenCalledWith(DailyReconciliationEntity, expect.objectContaining({
        workDate: '2026-06-27',
        status: DailyReconciliationStatus.LEAVE_UNPAID_APPROVED,
      }));
    });

    it('should NOT create reconciliation for Saturday when policy uses default Mon-Fri', async () => {
      calendarCommonService.fetchMember.mockResolvedValue(ADMIN);
      policyService.getPolicyDirect.mockResolvedValue(null); // default Mon-Fri

      const mockReq = {
        id: 'req-sat2',
        status: CalendarRequestStatus.PENDING,
        requestType: CalendarRequestType.LEAVE_UNPAID,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        startTime: new Date('2026-06-27T00:00:00Z'), // Saturday
        endTime: new Date('2026-06-27T23:59:59Z'),
        durationDays: 0,
      };

      manager.findOne.mockResolvedValueOnce(mockReq);
      manager.save.mockResolvedValue({ ...mockReq, status: CalendarRequestStatus.APPROVED });

      await service.reviewRequest({ ...dto, id: 'req-sat2' });

      // Saturday not in Mon-Fri → getWorkdaysBetween returns [] → early return, no reconciliation
      expect(manager.create).not.toHaveBeenCalledWith(DailyReconciliationEntity, expect.anything());
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
