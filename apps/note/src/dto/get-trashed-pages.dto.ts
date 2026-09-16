import { IsNotEmpty, IsUUID } from 'class-validator';

export class GetTrashedPagesDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — chỉ trả trang do chính mình xoá (trash mang tính cá nhân)
}
