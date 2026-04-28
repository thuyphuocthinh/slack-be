import { IsUUID, IsNotEmpty } from 'class-validator';

export class ToggleStarDto {
    @IsUUID()
    @IsNotEmpty()
    channelId: string;

    @IsUUID()
    @IsNotEmpty()
    memberId: string;
}
