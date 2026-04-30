import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ToggleReactionDto {
  @IsUUID()
  @IsNotEmpty()
  messageId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  emoji: string;
}
