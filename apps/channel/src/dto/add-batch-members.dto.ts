import { IsArray, IsNotEmpty, IsUUID } from 'class-validator';

export class AddBatchMembersDto {
    @IsUUID()
    @IsNotEmpty()
    channelId: string;

    @IsArray()
    @IsUUID('4', { each: true })
    @IsNotEmpty()
    targetMemberIds: string[];

    @IsUUID()
    @IsNotEmpty()
    performerId: string;
}
