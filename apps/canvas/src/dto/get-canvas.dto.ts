import { IsNotEmpty, IsUUID } from 'class-validator';

export class GetCanvasByChannelDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class GetCanvasByIdDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
