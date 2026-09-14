import { Expose } from 'class-transformer';
import { ViewType } from '../types/views.types';

export class ViewResponseDto {
  @Expose()
  id: string;

  @Expose()
  pageId: string;

  @Expose()
  type: ViewType;

  @Expose()
  name: string | null;

  @Expose()
  config: Record<string, unknown>;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
