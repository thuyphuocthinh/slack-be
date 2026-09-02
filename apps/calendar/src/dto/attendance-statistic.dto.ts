import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class StatisticSummaryResponseDto {
  @Expose()
  totalWorkHours: number;

  @Expose()
  lateDays: number;

  @Expose()
  absentDays: number;

  @Expose()
  leaveDays: number;
}

@Exclude()
export class WorkspaceMemberStatisticResponseDto extends StatisticSummaryResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  workspaceId: string;

  @Expose()
  role: string;

  @Expose()
  employmentType: string;

  @Expose()
  firstName?: string | null;

  @Expose()
  lastName?: string | null;

  @Expose()
  email?: string | null;

  @Expose()
  avatarUrl?: string | null;

  @Expose()
  joinedAt: string;

  @Expose()
  isBot?: boolean | null;
}

@Exclude()
export class PersonalChartDataResponseDto {
  @Expose()
  date: string;

  @Expose()
  workHours: number;

  @Expose()
  status: string;
}
