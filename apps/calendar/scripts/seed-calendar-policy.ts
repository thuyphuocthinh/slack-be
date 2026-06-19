import { NestFactory } from '@nestjs/core';
import { CalendarModule } from '../src/calendar.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceCalendarPolicyEntity } from '../src/entity/workspace_calendar_policy.entity';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('SeedCalendarPolicy');
  logger.log('Bootstrapping Calendar Application for Seeding...');

  // Khởi tạo app context để lấy TypeORM connection
  const app = await NestFactory.createApplicationContext(CalendarModule);

  // Lấy Repository của WorkspaceCalendarPolicyEntity
  const policyRepository = app.get<Repository<WorkspaceCalendarPolicyEntity>>(
    getRepositoryToken(WorkspaceCalendarPolicyEntity),
  );

  // ID của một workspace mẫu (Sẽ cần thay thế bằng ID workspace thật khi chạy script)
  const mockWorkspaceId = '00000000-0000-0000-0000-000000000000';

  logger.log(`Checking existing policy for workspace ${mockWorkspaceId}...`);
  const existingPolicy = await policyRepository.findOne({
    where: { workspaceId: mockWorkspaceId },
  });

  if (existingPolicy) {
    logger.warn('Policy already exists for this workspace. Skipping seed.');
  } else {
    logger.log('Inserting default calendar policy (JSONB)...');

    // Cấu hình linh hoạt dạng JSONB cho Calendar Policy
    const defaultPolicyData = {
      lockDeadlineDay: 25,
      registrationStartDay: 15,
      maxWfhDaysPerMonth: 4,
      minFullTimeHours: 160.0,
      maxFullTimeHours: 208.0,
      minPartTimeHours: 80.0,
      maxPartTimeHours: 120.0,
      allowedOfficeIps: ['127.0.0.1', '192.168.1.1', '14.232.0.0/16'],
      gracePeriodMinutes: 15, // Cho phép đi muộn 15p không bị phạt
      faceSimilarityThreshold: 0.6, // Tỉ lệ AI match tối thiểu 60%
      maxPaidLeaveDaysPerYear: 12,
      holidays: ['2026-01-01', '2026-04-30', '2026-05-01', '2026-09-02'],
    };

    const newPolicy = policyRepository.create({
      workspaceId: mockWorkspaceId,
      policyData: defaultPolicyData,
    });

    await policyRepository.save(newPolicy);
    logger.log('✅ Successfully seeded default calendar policy!');
  }

  await app.close();
  logger.log('Seeding process completed.');
}

bootstrap().catch((err) => {
  console.error('Failed to seed calendar policy', err);
  process.exit(1);
});
