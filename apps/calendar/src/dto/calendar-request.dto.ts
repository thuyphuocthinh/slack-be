import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { ShiftLocation } from '../types/calendar.enum';

export class ShiftItemDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'workDate must be in YYYY-MM-DD format',
  })
  workDate: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'startTime must be a strictly UTC ISO string ending with Z' })
  startTime: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'endTime must be a strictly UTC ISO string ending with Z' })
  endTime: string;
}

export class BulkRegisterWorkShiftDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftItemDto)
  @IsNotEmpty()
  shifts: ShiftItemDto[];

  @IsEnum(ShiftLocation)
  @IsNotEmpty()
  location: ShiftLocation;
}

export class GetWorkShiftsDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format' })
  endDate: string;

  @IsUUID()
  @IsOptional()
  userId?: string;
}
