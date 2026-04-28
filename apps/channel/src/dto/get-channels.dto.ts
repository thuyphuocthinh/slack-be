import { IsUUID, IsNotEmpty, IsEnum, IsOptional, IsInt, Min } from 'class-validator';
import { ChannelTypeEnum } from '@slack/constants';
import { Type } from 'class-transformer';

export class GetChannelsDto {
    @IsUUID()
    @IsNotEmpty()
    workspaceId: string;

    @IsUUID()
    @IsNotEmpty()
    memberId: string;

    @IsEnum(ChannelTypeEnum)
    @IsOptional()
    type?: ChannelTypeEnum;

    @IsInt()
    @Min(1)
    @IsOptional()
    @Type(() => Number)
    page?: number = 1;

    @IsInt()
    @Min(1)
    @IsOptional()
    @Type(() => Number)
    limit?: number = 20;
}
