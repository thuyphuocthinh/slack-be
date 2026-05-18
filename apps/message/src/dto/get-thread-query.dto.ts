import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class GetThreadQueryDto {
  @IsNumber()
  @IsOptional()
  limit?: number;

  @IsString()
  @IsOptional()
  cursor?: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;
}
