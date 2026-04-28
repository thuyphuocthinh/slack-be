import { Controller, Get } from '@nestjs/common';
import { MessageService } from './service/message.service';

@Controller()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Get()
  getHello(): string {
    return this.messageService.getHello();
  }
}
