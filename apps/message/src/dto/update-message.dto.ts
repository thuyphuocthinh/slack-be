import { IsDefined, IsNotEmpty } from 'class-validator';

export class UpdateMessageDto {
  @IsDefined()
  @IsNotEmpty()
  content: string | Record<string, unknown>[];
}
