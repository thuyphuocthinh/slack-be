import { Controller, Get } from '@nestjs/common';
import { ChannelService } from './channel.service';

@Controller()
export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  @Get()
  getHello(): string {
    return this.channelService.getHello();
  }
}
