import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChannelTypeEnum } from '@slack/constants';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateChannelApiDto {
  @ApiProperty({ example: 'general' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ enum: ChannelTypeEnum, example: ChannelTypeEnum.GROUP })
  @IsEnum(ChannelTypeEnum)
  @IsOptional()
  type?: ChannelTypeEnum;

  @ApiPropertyOptional({ example: 'General discussion channel' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateChannelApiDto {
  @ApiPropertyOptional({ example: 'random' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Random discussion channel' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class GetChannelsApiDto {
  @ApiPropertyOptional({ enum: ChannelTypeEnum })
  @IsEnum(ChannelTypeEnum)
  @IsOptional()
  type?: ChannelTypeEnum;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class AddMemberApiDto {
  @ApiProperty({ example: 'user-uuid' })
  @IsUUID()
  @IsNotEmpty()
  targetMemberId: string;
}

export class AddBatchMembersApiDto {
  @ApiProperty({ example: ['user-uuid-1', 'user-uuid-2'] })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsNotEmpty()
  targetMemberIds: string[];
}
