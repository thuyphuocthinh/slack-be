import { IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";

export class MemberInfoDto {
    @IsUUID()
    @IsNotEmpty()
    memberId: string;

    @IsString()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsOptional()
    firstName?: string;

    @IsString()
    @IsOptional()
    lastName?: string;

    @IsString()
    @IsOptional()
    avatarUrl: string;
}