import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Worker } from 'worker_threads';
import * as path from 'path';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { DailyReconciliationStatus } from '../types/calendar.enum';
import type { ExcelWorkerInput } from '../workers/excel.worker';
import { StatisticSummaryResponseDto, WorkspaceMemberStatisticResponseDto, PersonalChartDataResponseDto } from '../dto/attendance-statistic.dto';
import { CalendarCommonService } from './calendar-common.service';
import { randomUUID } from 'crypto';
import { CachedService, TTL, CACHE } from '@slack/cached';
import { QueueService, EQueueName, EJobName } from '@slack/queue';

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
    const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
    this.calendarCommonService.assertSelfOrPrivileged(requestorId, userId, requestor.role);
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
  ): Promise<WorkspaceMemberStatisticResponseDto[]> {
    const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
    this.calendarCommonService.assertPrivileged(requestor.role);

    const cacheKey = CACHE.CALENDAR.KEYS.WORKSPACE_MEMBER_STATS(workspaceId, month);
    const hit = await this.cachedService.get<WorkspaceMemberStatisticResponseDto[]>(cacheKey);
    if (hit) return hit;

    const startDate = `${month}-01`;
    const [year, m] = month.split('-');
    const endDay = new Date(Number(year), Number(m), 0).getDate();
    const endDate = `${month}-${endDay}`;

    const qb = this.reconcRepository.createQueryBuilder('recon');

    qb.where('recon.workspaceId = :workspaceId', { workspaceId })
      .andWhere('recon.workDate >= :startDate', { startDate })
      .andWhere('recon.workDate <= :endDate', { endDate });

    qb.select('recon.userId', 'userId')
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

    const [rawResults, allMembers] = await Promise.all([
      qb.getRawMany(),
      this.calendarCommonService.getWorkspaceMembers(workspaceId, requestorId),
    ]);

    const reconMap = new Map(rawResults.map(r => [r.userId, r]));

    const result = allMembers.map((member: any) => {
      const r = reconMap.get(member.userId);
      return {
        userId: member.userId,
        totalWorkHours: Number(r?.totalWorkHours || 0),
        lateDays: Number(r?.lateDays || 0),
        absentDays: Number(r?.absentDays || 0),
        leaveDays: Number(r?.leaveDays || 0),
      };
    });

    await this.cachedService.set(cacheKey, result, TTL.SHORT);
    return result;
  }

  async getPersonalChartData(
    workspaceId: string,
    requestorId: string,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<PersonalChartDataResponseDto[]> {
    const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
    this.calendarCommonService.assertSelfOrPrivileged(requestorId, userId, requestor.role);

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
    // Fetch all data on main thread (DB access not available inside worker)
    const membersData = await this.getWorkspaceMembers(workspaceId, requestorId, month);

    const startDate = `${month}-01`;
    const [year, m] = month.split('-');
    const endDay = new Date(Number(year), Number(m), 0).getDate();
    const endDate = `${month}-${endDay}`;

    const rawLogs = await this.reconcRepository.createQueryBuilder('recon')
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
      // __dirname resolves to dist/apps/calendar/src/services/ at runtime
      const workerPath = path.join(__dirname, '../workers/excel.worker.js');
      const worker = new Worker(workerPath, { workerData: input });

      worker.on('message', (data: Buffer | ArrayBuffer) => {
        resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Excel worker exited with code ${code}`));
      });
    });
  }

  async enqueueExport(
    workspaceId: string,
    requestorId: string,
    month: string,
  ): Promise<{ jobId: string }> {
    const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
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

  async getExportStatus(workspaceId: string, requestorId: string, jobId: string): Promise<{
    status: 'PENDING' | 'DONE' | 'FAILED';
    data?: string;
    error?: string;
  }> {
    const requestor = await this.calendarCommonService.fetchMember(workspaceId, requestorId);
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
