import { IsNotEmpty, IsUUID } from 'class-validator';

export class RestorePageDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — chỉ owner được khôi phục
}
