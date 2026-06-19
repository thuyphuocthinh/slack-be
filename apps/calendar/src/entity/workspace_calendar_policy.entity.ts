import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('workspace_calendar_policies')
export class WorkspaceCalendarPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid', unique: true })
  workspaceId: string;

  @Column({ name: 'policy_data', type: 'jsonb' })
  policyData: Record<string, any>;
  /*
    Cấu trúc mẫu:
    {
      "lockDeadlineDay": 25,
      "registrationStartDay": 15,
      "maxWfhDaysPerMonth": 4,
      "minFullTimeHours": 160,
      "maxFullTimeHours": 208,
      "minPartTimeHours": 80,
      "maxPartTimeHours": 120,
      "allowedOfficeIps": ["14.232.x.x"],
      "gracePeriodMinutes": 15,
      "faceSimilarityThreshold": 0.6,
      "holidays": ["2026-01-01", "2026-04-30"],
      "maxPaidLeaveDaysPerYear": 12
    }
  */

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
