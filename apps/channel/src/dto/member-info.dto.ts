import { IsNotEmpty, IsUUID } from 'class-validator';

export class MemberInfoDto {
    @IsUUID()
    @IsNotEmpty()
    memberId: string;
}
