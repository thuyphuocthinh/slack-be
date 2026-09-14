import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDefined, IsUUID } from 'class-validator';

export class SetPropertyValueApiDto {
  @IsDefined()
  value: unknown; // linh hoạt theo PropertyType (string/number/boolean...)
}

// Query param dạng "?rowIds=a,b,c" -> tách thành mảng trước khi validate
export class GetPropertyValuesForRowsApiDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  rowIds: string[];
}
