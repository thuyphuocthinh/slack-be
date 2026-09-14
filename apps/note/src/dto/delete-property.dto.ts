import { IsNotEmpty, IsUUID } from 'class-validator';

export class DeletePropertyDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
