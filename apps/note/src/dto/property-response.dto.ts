import { Expose } from 'class-transformer';
import { PropertyType } from '../types/properties.types';

export class PropertyResponseDto {
  @Expose()
  id: string;

  @Expose()
  pageId: string;

  @Expose()
  name: string;

  @Expose()
  type: PropertyType;

  @Expose()
  options: Record<string, unknown> | null;

  @Expose()
  order: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
