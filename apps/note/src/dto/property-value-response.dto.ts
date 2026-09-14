import { Expose } from 'class-transformer';

export class PropertyValueResponseDto {
  @Expose()
  id: string;

  @Expose()
  pageId: string;

  @Expose()
  propertyId: string;

  @Expose()
  value: unknown;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
