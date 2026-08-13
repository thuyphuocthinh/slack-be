import { IsIn, IsNotEmpty, IsUUID } from 'class-validator';

export class ToggleFeedbackDto {
  @IsUUID()
  @IsNotEmpty()
  messageId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsIn(['like', 'unlike'])
  @IsNotEmpty()
  type: 'like' | 'unlike';
}
