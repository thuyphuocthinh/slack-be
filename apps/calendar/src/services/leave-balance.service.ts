import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { LeaveBalanceEntity } from '../entity/leave_balance.entity';
import { CalendarCommonService } from './calendar-common.service';
import { LeaveBalanceResponseDto } from '../dto/calendar-response.dto';
import { CALENDAR_ERROR, AUTH_ERROR, DEFAULT_PAID_LEAVE_DAYS } from '@slack/constants';

import { WorkspaceCalendarPolicyService } from './workspace-calendar-policy.service';

@Injectable()
export class LeaveBalanceService {
  private readonly logger = new Logger(LeaveBalanceService.name);

  constructor(
    @InjectRepository(LeaveBalanceEntity)
    private readonly leaveBalanceRepo: Repository<LeaveBalanceEntity>,
    private readonly calendarCommonService: CalendarCommonService,
    private readonly policyService: WorkspaceCalendarPolicyService,
  ) { }

  async getMyLeaveBalance(workspaceId: string, userId: string, year: number) {
    try {
      await this.calendarCommonService.fetchMember(workspaceId, userId);

      const policy = await this.policyService.getPolicy(workspaceId);
      const maxPaidLeaveDays = policy?.policyData?.maxPaidLeaveDaysPerYear ?? DEFAULT_PAID_LEAVE_DAYS;

      let balance = await this.leaveBalanceRepo.findOne({
        where: { workspaceId, userId, year },
      });

      if (!balance) {
        return {
          id: 'default',
          workspaceId,
          userId,
          year,
          totalPaidLeave: maxPaidLeaveDays,
          usedPaidLeave: 0,
        };
      }

      balance.totalPaidLeave = maxPaidLeaveDays;
      return plainToInstance(LeaveBalanceResponseDto, balance);
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('Error getting my leave balance:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.FETCH_LEAVE_BALANCE_FAILED,
      });
    }
  }

  async getWorkspaceLeaveBalances(workspaceId: string, requestorId: string, year: number) {
    try {
      const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
      
      if (!this.calendarCommonService.isPrivileged(requestor.role)) {
         throw new RpcException({
            statusCode: HttpStatus.FORBIDDEN,
            ...AUTH_ERROR.FORBIDDEN,
         });
      }

      const policy = await this.policyService.getPolicy(workspaceId);
      const maxPaidLeaveDays = policy?.policyData?.maxPaidLeaveDaysPerYear ?? DEFAULT_PAID_LEAVE_DAYS;

      // 1. Fetch all members in the workspace
      const allMembers: any[] = await this.calendarCommonService.getWorkspaceMembers(workspaceId, requestorId);

      // 2. Fetch existing balances
      const existingBalances = await this.leaveBalanceRepo.find({
        where: { workspaceId, year },
      });

      const balanceMap = new Map(existingBalances.map(b => [b.userId, b]));

      // 3. Map all members to their balances, defaulting if no balance exists yet
      return allMembers.map((member) => {
        const existing = balanceMap.get(member.userId);
        
        const balanceDto = existing ? {
          id: existing.id,
          workspaceId: existing.workspaceId,
          userId: existing.userId,
          year: existing.year,
          totalPaidLeave: maxPaidLeaveDays, // always override with current policy
          usedPaidLeave: existing.usedPaidLeave,
        } : {
          id: `default-${member.userId}`,
          workspaceId,
          userId: member.userId,
          year,
          totalPaidLeave: maxPaidLeaveDays,
          usedPaidLeave: 0,
        };

        return plainToInstance(LeaveBalanceResponseDto, balanceDto);
      });
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('Error getting workspace leave balances:', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...CALENDAR_ERROR.FETCH_LEAVE_BALANCES_FAILED,
      });
    }
  }
}
