import { IsUUID, IsNotEmpty } from 'class-validator';

export class ChannelMemberDto {
    @IsUUID()
    @IsNotEmpty()
    channelId: string;

    @IsUUID()
    @IsNotEmpty()
    targetMemberId: string;

    @IsUUID()
    @IsNotEmpty()
    performerId: string;
}
