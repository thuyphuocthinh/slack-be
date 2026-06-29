/**
 * Worker thread for CPU-intensive ExcelJS generation.
 * Runs in an isolated thread — no NestJS DI, no DB access.
 * Receives pre-fetched data via workerData, posts Buffer back via parentPort.
 */
import { workerData, parentPort, isMainThread } from 'worker_threads';
import { DailyReconciliationStatus } from '../types/calendar.enum';

export interface ExcelWorkerInput {
  membersData: Array<{
    userId: string;
    totalWorkHours: number;
    lateDays: number;
    absentDays: number;
    leaveDays: number;
  }>;
  rawLogs: Array<{
    userId: string;
    workDate: string | Date;
    status: string;
  }>;
}

async function generateExcel(input: ExcelWorkerInput): Promise<Buffer> {
  const { membersData, rawLogs } = input;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

  // Sheet 2: Daily detail (31 columns)
  const detailSheet = workbook.addWorksheet('Chi Tiết Điểm Danh');
  const cols: Array<{ header: string; key: string; width: number }> = [
    { header: 'Mã NV', key: 'userId', width: 40 },
  ];
  for (let i = 1; i <= 31; i++) {
    cols.push({ header: `Ngày ${i}`, key: `day_${i}`, width: 10 });
  }
  detailSheet.columns = cols;

  const userLogsMap: Record<string, Record<string, string>> = {};
  for (const log of rawLogs) {
    if (!userLogsMap[log.userId]) userLogsMap[log.userId] = {};

    let day = 1;
    if (typeof log.workDate === 'string') {
      const parts = log.workDate.split('-');
      day = parts.length >= 3
        ? parseInt(parts[2].substring(0, 2), 10)
        : new Date(log.workDate).getDate();
    } else if (log.workDate instanceof Date) {
      day = log.workDate.getDate();
    }

    let marker = '✓';
    if (log.status === DailyReconciliationStatus.LATE_EARLY) marker = 'M';
    if (log.status === DailyReconciliationStatus.ABSENT) marker = 'V';
    if (
      log.status === DailyReconciliationStatus.LEAVE_PAID_APPROVED ||
      log.status === DailyReconciliationStatus.LEAVE_UNPAID_APPROVED
    ) {
      marker = 'P';
    }

    userLogsMap[log.userId][`day_${day}`] = marker;
  }

  for (const member of membersData) {
    const row: Record<string, string> = { userId: member.userId };
    for (let i = 1; i <= 31; i++) {
      row[`day_${i}`] = userLogsMap[member.userId]?.[`day_${i}`] || '';
    }
    detailSheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as Buffer;
}

// Entry point — only runs when this file is loaded as a worker thread, not when imported for types
if (!isMainThread) {
  generateExcel(workerData as ExcelWorkerInput)
    .then((buffer) => parentPort!.postMessage(buffer))
    .catch((err) => { throw err; });
}
