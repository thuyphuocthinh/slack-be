import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RateLimit } from '../common/guards/rate-limit.decorator';
import { Public } from '@slack/common';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';
import { WebhookReceiverService } from './webhook-receiver.service';

@ApiTags('Incoming Webhooks')
@Controller('services/commands')
export class CommandReceiverController {
  constructor(private readonly webhookReceiverService: WebhookReceiverService) {}

  @Post('response/:token')
  @Public()
  @RateLimit({ limit: 5, window: 1000 })
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive command response from external bots' })
  async receiveCommandResponse(
    @Param('token') token: string,
    @Body() payload: WebhookPayloadDto,
  ) {
    return this.webhookReceiverService.processCommandResponse(token, payload);
  }
}
