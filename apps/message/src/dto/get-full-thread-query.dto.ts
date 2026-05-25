import {
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
} from 'class-validator';

export class GetFullThreadQueryDto {
    @IsNumber()
    @IsOptional()
    limit?: number;

    @IsString()
    @IsOptional()
    cursor?: string;

    @IsUUID()
    @IsNotEmpty()
    threadId: string;
}
