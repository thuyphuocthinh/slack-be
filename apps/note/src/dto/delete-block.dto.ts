import { IsNotEmpty, IsUUID } from 'class-validator';

export class DeleteBlockDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — check quyền Edit trước khi xóa
}
