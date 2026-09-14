import { IsNotEmpty, IsUUID } from 'class-validator';

export class GetViewsByPageDto {
  @IsUUID()
  @IsNotEmpty()
  pageId: string; // page Database (cha)

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
