import { IsNotEmpty, IsUUID } from 'class-validator';

export class GetPropertiesByPageDto {
  @IsUUID()
  @IsNotEmpty()
  pageId: string; // page Database (cha)

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
