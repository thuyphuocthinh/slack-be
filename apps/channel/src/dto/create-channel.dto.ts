import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ChannelTypeEnum } from '@slack/constants';

export class CreateChannelDto {
    @IsUUID()
    @IsNotEmpty()
    workspaceId: string;

    @IsString()
    @IsOptional()
    title?: string;

    @IsEnum(ChannelTypeEnum)
    @IsOptional()
    type?: ChannelTypeEnum;

    @IsString()
    @IsOptional()
    description?: string;

    @IsUUID()
    @IsNotEmpty()
    memberId: string;

    @IsArray()
    @IsUUID('4', { each: true })
    @IsOptional()
    targetMemberIds?: string[];
}
