import { IsNotEmpty, IsUUID } from 'class-validator';

export class DeleteViewDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
