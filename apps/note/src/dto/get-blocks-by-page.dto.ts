import { IsNotEmpty, IsUUID } from 'class-validator';

// Không phân trang — số block/1 page bị chặn tự nhiên (1 trang note thường),
// khác với Pages (có thể hàng nghìn page/workspace) cần page/limit.
export class GetBlocksByPageDto {
  @IsUUID()
  @IsNotEmpty()
  pageId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — check quyền View/Edit trước khi trả blocks
}
