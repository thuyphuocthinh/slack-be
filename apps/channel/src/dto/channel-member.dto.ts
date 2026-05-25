import { IsUUID, IsNotEmpty, ValidateNested } from 'class-validator';
import { MemberInfoDto } from './member-info.dto';
import { Type } from 'class-transformer';

export class ChannelMemberDto {
    @IsUUID()
    @IsNotEmpty()
    channelId: string;

    @Type(() => MemberInfoDto)
    @ValidateNested()
    @IsNotEmpty()
    targetMember: MemberInfoDto;

    @IsUUID()
    @IsNotEmpty()
    performerId: string;
}
