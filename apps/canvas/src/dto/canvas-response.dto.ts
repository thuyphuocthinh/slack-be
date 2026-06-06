import { Expose } from 'class-transformer';

export class CanvasResponseDto {
  @Expose()
  id: string;

  @Expose()
  channelId: string;

  @Expose()
  updatedBy: string;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  contentJson?: Record<string, unknown>;
}
