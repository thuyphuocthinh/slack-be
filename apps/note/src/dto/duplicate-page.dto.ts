import { IsNotEmpty, IsUUID } from 'class-validator';

export class DuplicatePageDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — chủ sở hữu bản duplicate mới, không phải owner của page gốc
}
