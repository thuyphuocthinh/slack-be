import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiParam } from '@nestjs/swagger';
import type { Response } from 'express';
import { IntegrationsService } from './integrations.service';
import { AuthCallbackQueryDto } from './dto/integrations-api.dto';
import { IntegrationProvider } from '@slack/constants';
import { RateLimit } from '../common/guards/rate-limit.decorator';

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsCallbackController {
  constructor(private readonly integrationsService: IntegrationsService) { }

  @Get('callback/:provider')
  @RateLimit({ limit: 10, window: 60 })
  @ApiOperation({ summary: 'OAuth2 Callback URL for providers to redirect to' })
  @ApiParam({ name: 'provider', enum: IntegrationProvider })
  async handleCallback(
    @Param('provider') provider: string,
    @Query() query: AuthCallbackQueryDto,
    @Res() res: Response,
  ) {
    const result = await this.integrationsService.handleCallback(provider, query.code, query.state);

    // Redirect back to returnUrl if present, else fallback to settings
    const redirectUrl = result.returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/integrations/success`;
    return res.redirect(redirectUrl);
  }
}
