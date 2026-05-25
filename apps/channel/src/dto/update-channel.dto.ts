import { IsOptional, IsString, IsUUID, IsNotEmpty } from 'class-validator';

export class UpdateChannelDto {
    @IsUUID()
    @IsNotEmpty()
    channelId: string;

    @IsUUID()
    @IsNotEmpty()
    memberId: string;

    @IsString()
    @IsOptional()
    title?: string;

    @IsString()
    @IsOptional()
    description?: string;
}
