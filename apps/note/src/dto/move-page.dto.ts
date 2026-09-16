import { IsInt, IsNotEmpty, IsOptional, IsUUID, Min } from 'class-validator';

// newParentId: undefined/null = chuyển thành trang gốc (root).
// newIndex: undefined = chèn vào cuối danh sách anh em ở đích.
export class MovePageDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — service check quyền Edit trước khi move

  @IsOptional()
  @IsUUID()
  newParentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  newIndex?: number;
}
