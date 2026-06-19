import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { ShiftLocation } from '../types/calendar.enum';

export class BulkRegisterWorkShiftDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    each: true,
    message: 'Each date must be in YYYY-MM-DD format',
  })
  dates: string[];

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be in HH:mm format',
  })
  @IsNotEmpty()
  startTime: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'endTime must be in HH:mm format',
  })
  @IsNotEmpty()
  endTime: string;

  @IsEnum(ShiftLocation)
  @IsNotEmpty()
  location: ShiftLocation;
}
