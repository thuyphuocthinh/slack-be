import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
  IsUUID,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction, AuditEntityType } from '../types/audit.type';

export class CreateAuditLogDto {
  @IsEnum(AuditAction)
  action: AuditAction;

  @IsUUID()
  @IsOptional()
  actorId?: string;

  @IsString()
  @IsOptional()
  targetId?: string;

  @IsEnum(AuditEntityType)
  entityType: AuditEntityType;

  @IsString()
  @IsNotEmpty()
  entityId: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class FetchAuditLogsDto {
  @IsUUID()
  @IsOptional()
  actorId?: string;

  @IsString()
  @IsOptional()
  targetId?: string;

  @IsEnum(AuditEntityType)
  @IsOptional()
  entityType?: AuditEntityType;

  @IsString()
  @IsOptional()
  entityId?: string;

  @IsEnum(AuditAction)
  @IsOptional()
  action?: AuditAction;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}
