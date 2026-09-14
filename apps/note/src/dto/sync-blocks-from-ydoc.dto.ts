import { IsUUID } from 'class-validator';

export class SyncBlocksFromYdocDto {
  @IsUUID()
  pageId: string;
}
