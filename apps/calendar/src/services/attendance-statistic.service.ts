import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyReconciliationEntity } from '../entity/daily_reconciliation.entity';
import { DailyReconciliationStatus } from '../types/calendar.enum';
import { StatisticSummaryResponseDto, WorkspaceMemberStatisticResponseDto, PersonalChartDataResponseDto } from '../dto/attendance-statistic.dto';

@Injectable()
export class AttendanceStatisticService {
  constructor(
    @InjectRepository(DailyReconciliationEntity)
    private readonly reconcRepository: Repository<DailyReconciliationEntity>,
  ) {}

  async getPersonalSummary(
    workspaceId: string,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<StatisticSummaryResponseDto> {
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
    month: string, // YYYY-MM
  ): Promise<WorkspaceMemberStatisticResponseDto[]> {
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

    const rawResults = await qb.getRawMany();

    return rawResults.map((r) => ({
      userId: r.userId,
      totalWorkHours: Number(r.totalWorkHours || 0),
      lateDays: Number(r.lateDays || 0),
      absentDays: Number(r.absentDays || 0),
      leaveDays: Number(r.leaveDays || 0),
    }));
  }

  async getPersonalChartData(
    workspaceId: string,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<PersonalChartDataResponseDto[]> {
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
    month: string, // YYYY-MM
  ): Promise<Buffer> {
    const membersData = await this.getWorkspaceMembers(workspaceId, month);

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Slack App System';
    
    // Sheet 1: Summary
    const summarySheet = workbook.addWorksheet('Tổng Hợp');
    summarySheet.columns = [
      { header: 'Mã NV', key: 'userId', width: 40 },
      { header: 'Tổng Giờ Làm', key: 'totalWorkHours', width: 15 },
      { header: 'Số Ngày Muộn', key: 'lateDays', width: 15 },
      { header: 'Số Ngày Phép', key: 'leaveDays', width: 15 },
      { header: 'Số Ngày Vắng', key: 'absentDays', width: 15 },
    ];
    
    summarySheet.addRows(membersData);

    // Sheet 2: Detailed 31 days
    const detailSheet = workbook.addWorksheet('Chi Tiết Điểm Danh');
    const cols = [{ header: 'Mã NV', key: 'userId', width: 40 }];
    for (let i = 1; i <= 31; i++) {
      cols.push({ header: `Ngày ${i}`, key: `day_${i}`, width: 10 });
    }
    detailSheet.columns = cols;

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

    const userLogsMap: Record<string, Record<string, string>> = {};
    for (const log of rawLogs) {
      if (!userLogsMap[log.userId]) userLogsMap[log.userId] = {};
      
      let day = 1;
      if (typeof log.workDate === 'string') {
        const parts = log.workDate.split('-');
        if (parts.length >= 3) {
          day = parseInt(parts[2].substring(0, 2), 10);
        } else {
          day = new Date(log.workDate).getDate();
        }
      } else if (log.workDate instanceof Date) {
        day = log.workDate.getDate();
      }

      let marker = '✓';
      if (log.status === DailyReconciliationStatus.LATE_EARLY) marker = 'M';
      if (log.status === DailyReconciliationStatus.ABSENT) marker = 'V';
      if (log.status === DailyReconciliationStatus.LEAVE_PAID_APPROVED || log.status === DailyReconciliationStatus.LEAVE_UNPAID_APPROVED) marker = 'P';
      
      userLogsMap[log.userId][`day_${day}`] = marker;
    }

    for (const userId of Object.keys(userLogsMap)) {
      const row: any = { userId };
      for (let i = 1; i <= 31; i++) {
        row[`day_${i}`] = userLogsMap[userId][`day_${i}`] || '';
      }
      detailSheet.addRow(row);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as Buffer;
  }
}
