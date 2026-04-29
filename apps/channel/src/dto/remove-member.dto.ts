import { IsUUID, IsNotEmpty } from 'class-validator';

export class RemoveMemberDto {
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
