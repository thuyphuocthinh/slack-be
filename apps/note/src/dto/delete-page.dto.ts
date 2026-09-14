import { IsNotEmpty, IsUUID } from 'class-validator';

export class DeletePageDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — service check quyền trước khi xóa
}
