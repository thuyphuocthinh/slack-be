import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateCanvasDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
