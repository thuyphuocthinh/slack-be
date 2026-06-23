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
  userId: string;
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
