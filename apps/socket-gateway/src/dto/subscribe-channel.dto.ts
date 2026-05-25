import { IsString, IsNotEmpty } from 'class-validator';

export class SubscribeChannelDto {
  @IsString()
  @IsNotEmpty()
  channelId: string;
}
