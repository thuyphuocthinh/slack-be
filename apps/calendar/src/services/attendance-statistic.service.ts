import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Worker } from 'worker_threads';
import * as path from 'path';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { DailyReconciliationStatus } from '../types/calendar.enum';
import type { ExcelWorkerInput } from '../workers/excel.worker';
import {
  StatisticSummaryResponseDto,
  WorkspaceMemberStatisticResponseDto,
  PersonalChartDataResponseDto,
} from '../dto/attendance-statistic.dto';
import { CalendarCommonService } from './calendar-common.service';
import { randomUUID } from 'crypto';
import { CachedService, TTL, CACHE } from '@slack/cached';
import { QueueService, EQueueName, EJobName } from '@slack/queue';
import { IOffsetResponse } from '@slack/common';
import {
  SortOrder,
  WorkspaceStatisticFilter,
  WorkspaceStatisticSortBy,
} from '../dto/calendar-request.dto';

interface WorkspaceStatisticQuery {
  page?: number;
  limit?: number;
  search?: string;
  filter?: WorkspaceStatisticFilter;
  sortBy?: WorkspaceStatisticSortBy;
  sortOrder?: SortOrder;
}

@Injectable()
export class AttendanceStatisticService {
  constructor(
    @InjectRepository(DailyReconciliationEntity)
    private readonly reconcRepository: Repository<DailyReconciliationEntity>,
    private readonly calendarCommonService: CalendarCommonService,
    private readonly cachedService: CachedService,
    private readonly queueService: QueueService,
  ) {}

  async getPersonalSummary(
    workspaceId: string,
    requestorId: string,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<StatisticSummaryResponseDto> {
    const requestor = await this.calendarCommonService.fetchMember(
      workspaceId,
      requestorId,
    );
    this.calendarCommonService.assertSelfOrPrivileged(
      requestorId,
      userId,
      requestor.role,
    );
    const qb = this.reconcRepository.createQueryBuilder('recon');

    qb.where('recon.workspaceId = :workspaceId', { workspaceId })
      .andWhere('recon.userId = :userId', { userId })
      .andWhere('recon.workDate >= :startDate', { startDate })
      .andWhere('recon.workDate <= :endDate', { endDate });

    qb.select('SUM(recon.actualWorkHours)', 'totalWorkHours')
      .addSelect(
        `SUM(CASE WHEN recon.status = '${DailyReconciliationStatus.LATE_EARLY}' THEN 1 ELSE 0 END)`,
        'lateDays',
      )
      .addSelect(
        `SUM(CASE WHEN recon.status = '${DailyReconciliationStatus.ABSENT}' THEN 1 ELSE 0 END)`,
        'absentDays',
      )
      .addSelect(
        `SUM(CASE WHEN recon.status IN ('${DailyReconciliationStatus.LEAVE_PAID_APPROVED}', '${DailyReconciliationStatus.LEAVE_UNPAID_APPROVED}') THEN 1 ELSE 0 END)`,
        'leaveDays',
      );

    const rawResult = await qb.getRawOne();

    return {
      totalWorkHours: Number(rawResult.totalWorkHours || 0),
      lateDays: Number(rawResult.lateDays || 0),
      absentDays: Number(rawResult.absentDays || 0),
      leaveDays: Number(rawResult.leaveDays || 0),
    };
  }

  async getWorkspaceMembers(
    workspaceId: string,
    requestorId: string,
    month: string, // YYYY-MM
    query: WorkspaceStatisticQuery = {},
  ): Promise<IOffsetResponse<WorkspaceMemberStatisticResponseDto[]>> {
    const requestor = await this.calendarCommonService.fetchMember(
      workspaceId,
      requestorId,
    );
    this.calendarCommonService.assertPrivileged(requestor.role);

    const allMembers = await this.getWorkspaceMemberDataset(
      workspaceId,
      requestorId,
      month,
    );
    const {
      page = 1,
      limit = 50,
      search,
      filter = WorkspaceStatisticFilter.ALL,
      sortBy = WorkspaceStatisticSortBy.NAME,
      sortOrder = SortOrder.ASC,
    } = query;

    const normalizedSearch = search?.trim().toLocaleLowerCase('vi');
    const filtered = allMembers.filter((member) => {
      if (normalizedSearch) {
        const searchable = [
          member.firstName,
          member.lastName,
          member.email,
          member.userId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('vi');
        if (!searchable.includes(normalizedSearch)) return false;
      }

      switch (filter) {
        case WorkspaceStatisticFilter.LATE:
          return member.lateDays > 0;
        case WorkspaceStatisticFilter.ABSENT:
          return member.absentDays > 0;
        case WorkspaceStatisticFilter.LEAVE:
          return member.leaveDays > 0;
        case WorkspaceStatisticFilter.NO_ISSUES:
          return (
            member.lateDays === 0 &&
            member.absentDays === 0 &&
            member.leaveDays === 0
          );
        default:
          return true;
      }
    });

    const direction = sortOrder === SortOrder.DESC ? -1 : 1;
    filtered.sort((left, right) => {
      let comparison: number;
      if (sortBy === WorkspaceStatisticSortBy.NAME) {
        const leftName = [left.firstName, left.lastName]
          .filter(Boolean)
          .join(' ');
        const rightName = [right.firstName, right.lastName]
          .filter(Boolean)
          .join(' ');
        comparison = leftName.localeCompare(rightName, 'vi', {
          sensitivity: 'base',
        });
      } else {
        comparison = Number(left[sortBy]) - Number(right[sortBy]);
      }

      return comparison === 0
        ? left.userId.localeCompare(right.userId) * direction
        : comparison * direction;
    });

    const total = filtered.length;
    const offset = (page - 1) * limit;
    return {
      data: filtered.slice(offset, offset + limit),
      paging: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    } as unknown as IOffsetResponse<WorkspaceMemberStatisticResponseDto[]>;
  }

  private async getWorkspaceMemberDataset(
    workspaceId: string,
    requestorId: string,
    month: string,
  ): Promise<WorkspaceMemberStatisticResponseDto[]> {
    const cacheKey = CACHE.CALENDAR.KEYS.WORKSPACE_MEMBER_STATS(
      workspaceId,
      month,
    );
    return this.cachedService.getOrSetDetail(cacheKey, TTL.SHORT, async () => {
      const startDate = `${month}-01`;
      const [year, m] = month.split('-');
      const endDay = new Date(Number(year), Number(m), 0).getDate();
      const endDate = `${month}-${endDay}`;

      const qb = this.reconcRepository.createQueryBuilder('recon');
      qb.where('recon.workspaceId = :workspaceId', { workspaceId })
        .andWhere('recon.workDate >= :startDate', { startDate })
        .andWhere('recon.workDate <= :endDate', { endDate })
        .select('recon.userId', 'userId')
        .addSelect('SUM(recon.actualWorkHours)', 'totalWorkHours')
        .addSelect(
          `SUM(CASE WHEN recon.status = '${DailyReconciliationStatus.LATE_EARLY}' THEN 1 ELSE 0 END)`,
          'lateDays',
        )
        .addSelect(
          `SUM(CASE WHEN recon.status = '${DailyReconciliationStatus.ABSENT}' THEN 1 ELSE 0 END)`,
          'absentDays',
        )
        .addSelect(
          `SUM(CASE WHEN recon.status IN ('${DailyReconciliationStatus.LEAVE_PAID_APPROVED}', '${DailyReconciliationStatus.LEAVE_UNPAID_APPROVED}') THEN 1 ELSE 0 END)`,
          'leaveDays',
        )
        .groupBy('recon.userId');

      const [rawResults, workspaceMembers] = await Promise.all([
        qb.getRawMany(),
        this.calendarCommonService.getWorkspaceMembers(
          workspaceId,
          requestorId,
        ),
      ]);
      const reconMap = new Map(rawResults.map((row) => [row.userId, row]));

      return workspaceMembers.map((member: any) => {
        const reconciliation = reconMap.get(member.userId);
        return {
          ...member,
          totalWorkHours: Number(reconciliation?.totalWorkHours || 0),
          lateDays: Number(reconciliation?.lateDays || 0),
          absentDays: Number(reconciliation?.absentDays || 0),
          leaveDays: Number(reconciliation?.leaveDays || 0),
        };
      });
    });
  }

  async getPersonalChartData(
    workspaceId: string,
    requestorId: string,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<PersonalChartDataResponseDto[]> {
    const requestor = await this.calendarCommonService.fetchMember(
      workspaceId,
      requestorId,
    );
    this.calendarCommonService.assertSelfOrPrivileged(
      requestorId,
      userId,
      requestor.role,
    );

    const qb = this.reconcRepository.createQueryBuilder('recon');

    qb.where('recon.workspaceId = :workspaceId', { workspaceId })
      .andWhere('recon.userId = :userId', { userId })
      .andWhere('recon.workDate >= :startDate', { startDate })
      .andWhere('recon.workDate <= :endDate', { endDate })
      .orderBy('recon.workDate', 'ASC');

    qb.select('recon.workDate', 'date')
      .addSelect('recon.actualWorkHours', 'workHours')
      .addSelect('recon.status', 'status');

    const rawResults = await qb.getRawMany();

    return rawResults.map((r) => ({
      date: r.date,
      workHours: Number(r.workHours || 0),
      status: r.status,
    }));
  }

  async exportWorkspaceExcel(
    workspaceId: string,
    requestorId: string,
    month: string, // YYYY-MM
  ): Promise<Buffer> {
    const requestor = await this.calendarCommonService.fetchMember(
      workspaceId,
      requestorId,
    );
    this.calendarCommonService.assertPrivileged(requestor.role);

    // Export intentionally uses the complete cached dataset, not a UI page.
    const membersData = await this.getWorkspaceMemberDataset(
      workspaceId,
      requestorId,
      month,
    );

    const startDate = `${month}-01`;
    const [year, m] = month.split('-');
    const endDay = new Date(Number(year), Number(m), 0).getDate();
    const endDate = `${month}-${endDay}`;

    const rawLogs = await this.reconcRepository
      .createQueryBuilder('recon')
      .where('recon.workspaceId = :workspaceId', { workspaceId })
      .andWhere('recon.workDate >= :startDate', { startDate })
      .andWhere('recon.workDate <= :endDate', { endDate })
      .select('recon.userId', 'userId')
      .addSelect('recon.workDate', 'workDate')
      .addSelect('recon.status', 'status')
      .getRawMany();

    // Offload CPU-intensive ExcelJS work to a dedicated worker thread
    return this.runExcelWorker({ membersData, rawLogs });
  }

  private runExcelWorker(input: ExcelWorkerInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // webpack bundles the whole app into dist/apps/calendar/main.js, so
      // __dirname resolves to dist/apps/calendar/ at runtime — the worker
      // is built as a separate entry into workers/excel.worker.js alongside it
      // (see apps/calendar/webpack.config.js).
      const workerPath = path.join(__dirname, 'workers/excel.worker.js');
      const worker = new Worker(workerPath, { workerData: input });

      worker.on('message', (data: Buffer | ArrayBuffer) => {
        resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0)
          reject(new Error(`Excel worker exited with code ${code}`));
      });
    });
  }

  async enqueueExport(
    workspaceId: string,
    requestorId: string,
    month: string,
  ): Promise<{ jobId: string }> {
    const requestor = await this.calendarCommonService.fetchMember(
      workspaceId,
      requestorId,
    );
    this.calendarCommonService.assertPrivileged(requestor.role);

    const jobId = randomUUID();

    await this.cachedService.set(
      CACHE.CALENDAR.KEYS.EXPORT_JOB(jobId),
      { status: 'PENDING' },
      TTL.MEDIUM,
    );

    await this.queueService.addJob(
      EQueueName.CALENDAR_QUEUE,
      EJobName.CALENDAR_EXPORT_EXCEL,
      { jobId, workspaceId, requestorId, month },
      { removeOnComplete: true, attempts: 2 },
    );

    return { jobId };
  }

  async getExportStatus(
    workspaceId: string,
    requestorId: string,
    jobId: string,
  ): Promise<{
    status: 'PENDING' | 'DONE' | 'FAILED';
    data?: string;
    error?: string;
  }> {
    const requestor = await this.calendarCommonService.fetchMember(
      workspaceId,
      requestorId,
    );
    this.calendarCommonService.assertPrivileged(requestor.role);

    const result = await this.cachedService.get<{
      status: 'PENDING' | 'DONE' | 'FAILED';
      data?: string;
      error?: string;
    }>(CACHE.CALENDAR.KEYS.EXPORT_JOB(jobId));

    if (!result) return { status: 'FAILED', error: 'Job not found or expired' };
    return result;
  }
}
