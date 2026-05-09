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
  ValidateNested,
} from 'class-validator';

export class CreateChannelApiDto {
  @ApiPropertyOptional({ example: 'general' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({
    enum: ChannelTypeEnum,
    example: ChannelTypeEnum.GROUP,
  })
  @IsEnum(ChannelTypeEnum)
  @IsOptional()
  type?: ChannelTypeEnum;

  @ApiPropertyOptional({ example: 'General discussion channel' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: ['0bcda63b-d799-4771-bbfb-0c4e8c433e3b'] })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  targetMemberIds?: string[];
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

export class MemberInfoDto {
  @ApiProperty({ example: 'email@example.com' })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '0bcda63b-d799-4771-bbfb-0c4e8c433e3b' })
  @IsUUID()
  @IsNotEmpty()
  memberId: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: 'https://example.com/avatar.jpg' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;
}

export class AddMemberApiDto {
  @ApiProperty({ example: new MemberInfoDto() })
  @ValidateNested()
  @Type(() => MemberInfoDto)
  targetMember: MemberInfoDto;
}

export class AddBatchMembersApiDto {
  @ApiProperty({ example: [new MemberInfoDto(), new MemberInfoDto()] })
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MemberInfoDto)
  targetMembers: MemberInfoDto[];
}
