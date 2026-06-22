import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveBalanceEntity } from '../entity/leave_balance.entity';
import { CalendarCommonService } from './calendar-common.service';
import { CALENDAR_ERROR, AUTH_ERROR, DEFAULT_PAID_LEAVE_DAYS } from '@slack/constants';

import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';

describe('LeaveBalanceService', () => {
  let service: LeaveBalanceService;
  let leaveBalanceRepo: Repository<LeaveBalanceEntity>;
  let calendarCommonService: CalendarCommonService;
  let policyService: WorkspaceCalendarPolicyService;

  const mockWorkspaceId = 'ws-1';
  const mockUserId = 'user-1';
  const mockYear = 2026;

  const mockLeaveBalanceRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockCalendarCommonService = {
    fetchMember: jest.fn(),
    isPrivileged: jest.fn(),
    getWorkspaceMembers: jest.fn(),
  };

  const mockPolicyService = {
    getPolicy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveBalanceService,
        {
          provide: getRepositoryToken(LeaveBalanceEntity),
          useValue: mockLeaveBalanceRepo,
        },
        {
          provide: CalendarCommonService,
          useValue: mockCalendarCommonService,
        },
        {
          provide: WorkspaceCalendarPolicyService,
          useValue: mockPolicyService,
        },
      ],
    }).compile();

    service = module.get<LeaveBalanceService>(LeaveBalanceService);
    leaveBalanceRepo = module.get<Repository<LeaveBalanceEntity>>(getRepositoryToken(LeaveBalanceEntity));
    calendarCommonService = module.get<CalendarCommonService>(CalendarCommonService);
    policyService = module.get<WorkspaceCalendarPolicyService>(WorkspaceCalendarPolicyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMyLeaveBalance', () => {
    it('should return existing balance if found', async () => {
      const mockBalance = {
        id: 'bal-1',
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        year: mockYear,
        totalPaidLeave: 12, // the DB value doesn't matter much anymore since it's overridden
        usedPaidLeave: 5,
      };

      mockCalendarCommonService.fetchMember.mockResolvedValueOnce({ id: mockUserId, role: 'MEMBER' });
      mockLeaveBalanceRepo.findOne.mockResolvedValueOnce(mockBalance);
      mockPolicyService.getPolicy.mockResolvedValueOnce({ policyData: { maxPaidLeaveDaysPerYear: 15 } });

      const result = await service.getMyLeaveBalance(mockWorkspaceId, mockUserId, mockYear);

      expect(calendarCommonService.fetchMember).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(leaveBalanceRepo.findOne).toHaveBeenCalledWith({
        where: { workspaceId: mockWorkspaceId, userId: mockUserId, year: mockYear },
      });
      expect(result).toMatchObject({
        id: 'bal-1',
        totalPaidLeave: 15,
        usedPaidLeave: 5,
      });
    });

    it('should return default balance with default paid leave if no record exists and no policy', async () => {
      mockCalendarCommonService.fetchMember.mockResolvedValueOnce({ id: mockUserId, role: 'MEMBER' });
      mockLeaveBalanceRepo.findOne.mockResolvedValueOnce(null);
      mockPolicyService.getPolicy.mockResolvedValueOnce(null);

      const result = await service.getMyLeaveBalance(mockWorkspaceId, mockUserId, mockYear);

      expect(result).toEqual({
        id: 'default',
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        year: mockYear,
        totalPaidLeave: DEFAULT_PAID_LEAVE_DAYS,
        usedPaidLeave: 0,
      });
    });

    it('should return default balance with maxPaidLeaveDaysPerYear from policy if exists', async () => {
      mockCalendarCommonService.fetchMember.mockResolvedValueOnce({ id: mockUserId, role: 'MEMBER' });
      mockLeaveBalanceRepo.findOne.mockResolvedValueOnce(null);
      mockPolicyService.getPolicy.mockResolvedValueOnce({ policyData: { maxPaidLeaveDaysPerYear: 18 } });

      const result = await service.getMyLeaveBalance(mockWorkspaceId, mockUserId, mockYear);

      expect(result).toEqual({
        id: 'default',
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        year: mockYear,
        totalPaidLeave: 18,
        usedPaidLeave: 0,
      });
    });

    it('should throw RpcException if fetchMember fails', async () => {
      const authError = new RpcException({ statusCode: HttpStatus.FORBIDDEN, ...AUTH_ERROR.FORBIDDEN });
      mockCalendarCommonService.fetchMember.mockRejectedValueOnce(authError);

      await expect(service.getMyLeaveBalance(mockWorkspaceId, mockUserId, mockYear)).rejects.toThrow(authError);
    });

    it('should catch generic errors and throw FETCH_LEAVE_BALANCE_FAILED', async () => {
      mockCalendarCommonService.fetchMember.mockResolvedValueOnce({ id: mockUserId, role: 'MEMBER' });
      mockLeaveBalanceRepo.findOne.mockRejectedValueOnce(new Error('DB Error'));

      await expect(service.getMyLeaveBalance(mockWorkspaceId, mockUserId, mockYear)).rejects.toThrow(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.FETCH_LEAVE_BALANCE_FAILED,
        }),
      );
    });
  });

  describe('getWorkspaceLeaveBalances', () => {
    it('should return mapped balances if requestor is privileged', async () => {
      const mockBalances = [
        { id: 'bal-1', userId: 'user-1', workspaceId: mockWorkspaceId, year: mockYear, totalPaidLeave: 12, usedPaidLeave: 2 },
      ];
      
      const mockMembers = [
        { userId: 'user-1', role: 'MEMBER' },
        { userId: 'user-2', role: 'MEMBER' },
      ];

      mockCalendarCommonService.fetchMember.mockResolvedValueOnce({ id: mockUserId, role: 'ADMIN' });
      mockCalendarCommonService.isPrivileged.mockReturnValueOnce(true);
      mockCalendarCommonService.getWorkspaceMembers.mockResolvedValueOnce(mockMembers);
      mockLeaveBalanceRepo.find.mockResolvedValueOnce(mockBalances);

      const result = await service.getWorkspaceLeaveBalances(mockWorkspaceId, mockUserId, mockYear);

      expect(calendarCommonService.fetchMember).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(calendarCommonService.getWorkspaceMembers).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(calendarCommonService.isPrivileged).toHaveBeenCalledWith('ADMIN');
      expect(leaveBalanceRepo.find).toHaveBeenCalledWith({
        where: { workspaceId: mockWorkspaceId, year: mockYear },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'bal-1', userId: 'user-1', usedPaidLeave: 2 });
      expect(result[1]).toMatchObject({ id: 'default-user-2', userId: 'user-2', usedPaidLeave: 0 });
    });

    it('should throw FORBIDDEN if requestor is not privileged', async () => {
      mockCalendarCommonService.fetchMember.mockResolvedValueOnce({ id: mockUserId, role: 'MEMBER' });
      mockCalendarCommonService.isPrivileged.mockReturnValueOnce(false);

      await expect(service.getWorkspaceLeaveBalances(mockWorkspaceId, mockUserId, mockYear)).rejects.toThrow(
        new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...AUTH_ERROR.FORBIDDEN,
        }),
      );
    });

    it('should catch generic errors and throw FETCH_LEAVE_BALANCES_FAILED', async () => {
      mockCalendarCommonService.fetchMember.mockResolvedValueOnce({ id: mockUserId, role: 'ADMIN' });
      mockCalendarCommonService.isPrivileged.mockReturnValueOnce(true);
      mockLeaveBalanceRepo.find.mockRejectedValueOnce(new Error('DB Error'));

      await expect(service.getWorkspaceLeaveBalances(mockWorkspaceId, mockUserId, mockYear)).rejects.toThrow(
        new RpcException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          ...CALENDAR_ERROR.FETCH_LEAVE_BALANCES_FAILED,
        }),
      );
    });
  });
});
