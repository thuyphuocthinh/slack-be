import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';

export enum ShiftLocationApi {
  OFFICE = 'OFFICE',
  WFH = 'WFH',
}

export class ShiftItemApiDto {
  @ApiProperty({ example: '2026-06-20', description: 'YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'workDate must be in YYYY-MM-DD format' })
  workDate: string;

  @ApiProperty({ example: '2026-06-20T02:00:00.000Z' })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'startTime must be a strictly UTC ISO string ending with Z' })
  startTime: string;

  @ApiProperty({ example: '2026-06-20T11:00:00.000Z' })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'endTime must be a strictly UTC ISO string ending with Z' })
  endTime: string;
}

export class BulkRegisterWorkShiftApiDto {
  @ApiProperty({ type: [ShiftItemApiDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftItemApiDto)
  @IsNotEmpty()
  shifts: ShiftItemApiDto[];

  @ApiProperty({ enum: ShiftLocationApi })
  @IsEnum(ShiftLocationApi)
  @IsNotEmpty()
  location: ShiftLocationApi;

  @ApiPropertyOptional({ description: 'Defaults to current user if not provided' })
  @IsUUID()
  @IsOptional()
  userId?: string;
}

export class GetWorkShiftsApiDto {
  @ApiProperty({ example: '2026-06-01', description: 'YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate: string;

  @ApiProperty({ example: '2026-06-30', description: 'YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format' })
  endDate: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  userId?: string;
}

export class UpdateWorkShiftApiDto {
  @ApiPropertyOptional({ example: '2026-06-20', description: 'YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'workDate must be in YYYY-MM-DD format' })
  @IsOptional()
  workDate?: string;

  @ApiPropertyOptional({ example: '2026-06-20T02:00:00.000Z' })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'startTime must be a strictly UTC ISO string ending with Z' })
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({ example: '2026-06-20T11:00:00.000Z' })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'endTime must be a strictly UTC ISO string ending with Z' })
  @IsOptional()
  endTime?: string;

  @ApiPropertyOptional({ enum: ShiftLocationApi })
  @IsEnum(ShiftLocationApi)
  @IsOptional()
  location?: ShiftLocationApi;
}

export class PolicyDataApiDto {
  @ApiPropertyOptional({ example: 4, description: 'Max WFH days allowed per week' })
  @IsOptional()
  maxWfhDaysPerWeek?: number;

  @ApiPropertyOptional({ example: 208, description: 'Max working hours per month for FULLTIME' })
  @IsOptional()
  maxFullTimeHours?: number;

  @ApiPropertyOptional({ example: 120, description: 'Max working hours per month for PARTTIME' })
  @IsOptional()
  maxPartTimeHours?: number;

  @ApiPropertyOptional({ example: 25, description: 'Day of the month when calendar is locked' })
  @IsOptional()
  lockDeadlineDay?: number;
}

export class UpsertCalendarPolicyApiDto {
  @ApiProperty({ type: PolicyDataApiDto })
  @ValidateNested()
  @Type(() => PolicyDataApiDto)
  @IsNotEmpty()
  policyData: PolicyDataApiDto;
}
