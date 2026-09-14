import { IsNotEmpty, IsUUID } from 'class-validator';

export class GetBlockByIdDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — check quyền View/Edit trước khi trả block
}
