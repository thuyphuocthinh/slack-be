import { Body, Controller, HttpCode, Param, Post, Headers, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, INTEGRATIONS_MESSAGE_PATTERNS } from '@slack/constants';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { RateLimit } from '../common/guards/rate-limit.decorator';
import { Public } from '@slack/common';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';
import { WebhookReceiverService } from './webhook-receiver.service';

@ApiTags('Incoming Webhooks')
@Controller('services/hooks')
export class WebhookReceiverController {
  constructor(
    private readonly webhookReceiverService: WebhookReceiverService,
    @Inject(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE) private readonly integrationsClient: ClientProxy,
  ) { }

  @Post(':workspaceId/:channelId/:token')
  @Public()
  @RateLimit({ limit: 1, window: 1 }) // 1 request per second
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive incoming webhook payload from external services' })
  @ApiResponse({ status: 200, description: 'Payload received and queued successfully' })
  @ApiResponse({ status: 401, description: 'Invalid webhook token or not found' })
  @ApiBody({ type: WebhookPayloadDto })
  async receiveWebhook(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('token') token: string,
    @Body() payload: Record<string, string>,
  ) {
    return this.webhookReceiverService.processWebhook(workspaceId, channelId, token, payload);
  }

  @Post('integrations/:appType/:workspaceId/:channelId/:token')
  @Public()
  @RateLimit({ limit: 5, window: 1 })
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive incoming webhook payload from 3rd-party services (e.g., GitHub, Trello)' })
  @ApiResponse({ status: 200, description: 'Payload received and queued successfully' })
  async receiveIntegrationWebhook(
    @Param('appType') appType: string,
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('token') token: string,
    @Headers() headers: Record<string, string>,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.integrationsClient.send(INTEGRATIONS_MESSAGE_PATTERNS.QUEUE_INCOMING_WEBHOOK, {
      appType,
      workspaceId,
      channelId,
      token,
      headers,
      payload,
    });
  }
}
