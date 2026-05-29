import { Body, Controller, HttpCode, Post, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '@slack/common';
import { WebhookReceiverService } from './webhook-receiver.service';

@ApiTags('Views')
@Controller('views')
export class ViewsController {
  constructor(private readonly webhookReceiverService: WebhookReceiverService) { }

  @Post('open')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Open a modal view for a user (called by external bot)' })
  async openView(
    @Body('trigger_id') triggerId: string,
    @Body('view') view: any,
  ) {
    if (!triggerId || !view) {
      throw new BadRequestException('Missing trigger_id or view');
    }
    return this.webhookReceiverService.openView(triggerId, view);
  }
}
