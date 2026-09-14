import { ArrayNotEmpty, IsArray, IsNotEmpty, IsUUID } from 'class-validator';

// Lấy giá trị cho NHIỀU row cùng lúc (render cả bảng Table view) — check quyền
// đúng 1 LẦN ở page Database cha, không check từng row (tránh N+1 permission check).
export class GetPropertyValuesForRowsDto {
  @IsUUID()
  @IsNotEmpty()
  databasePageId: string; // page Database cha

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  rowIds: string[]; // các row (page con) cần lấy giá trị

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
