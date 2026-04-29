import { IsArray, IsNotEmpty, IsUUID } from 'class-validator';
import { MemberInfoDto } from './member-info.dto';

export class AddBatchMembersDto {
    @IsUUID()
    @IsNotEmpty()
    channelId: string;

    @IsArray()
    @IsNotEmpty()
    targetMembers: MemberInfoDto[];

    @IsUUID()
    @IsNotEmpty()
    performerId: string;
}
