import { IsDefined, IsNotEmpty, IsUUID } from 'class-validator';

// pageId ở đây là ROW (page con) — quyền check Ở ROW, không phải ở page Database cha
// (khác CreatePropertyDto/CreateViewDto — 2 cái đó check ở cha)
export class SetPropertyValueDto {
  @IsUUID()
  @IsNotEmpty()
  pageId: string;

  @IsUUID()
  @IsNotEmpty()
  propertyId: string;

  @IsDefined()
  value: unknown; // linh hoạt theo PropertyType (string/number/boolean...), không ép 1 kiểu cố định

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
