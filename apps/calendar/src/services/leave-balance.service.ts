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

      let balance = await this.leaveBalanceRepo.findOne({
        where: { workspaceId, userId, year },
      });

      if (!balance) {
        const policy = await this.policyService.getPolicy(workspaceId);
        const maxPaidLeaveDays = policy?.policyData?.maxPaidLeaveDaysPerYear ?? DEFAULT_PAID_LEAVE_DAYS;

        return {
          id: 'default',
          workspaceId,
          userId,
          year,
          totalPaidLeave: maxPaidLeaveDays,
          usedPaidLeave: 0,
        };
      }

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

      const balances = await this.leaveBalanceRepo.find({
        where: { workspaceId, year },
      });

      return balances.map((b) => plainToInstance(LeaveBalanceResponseDto, b));
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
