import { Controller, Get, Post, Delete, Param, Query, Body, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiParam, ApiBody } from '@nestjs/swagger';
import type { Response } from 'express';
import { IntegrationsService } from './integrations.service';
import { CurrentUser } from '@slack/common';
import type { JwtUser } from '@slack/common';
import { GenerateAuthUrlQueryDto, AuthCallbackQueryDto } from './dto/integrations-api.dto';
import { IntegrationProvider } from '@slack/constants';
import { RateLimit } from '../common/guards/rate-limit.decorator';

@ApiTags('Integrations')
@Controller('workspaces/:workspaceId/integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) { }

  @Get('my-connections')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all external integration connections for the current user' })
  async getMyConnections(@CurrentUser() user: JwtUser) {
    return this.integrationsService.getMyConnections(user.sub!);
  }

  @Get('auth/:provider')
  @RateLimit({ limit: 5, window: 60 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate OAuth2 authorization URL for a specific provider' })
  @ApiParam({ name: 'provider', enum: IntegrationProvider })
  async generateAuthUrl(
    @Param('workspaceId') workspaceId: string,
    @Param('provider') provider: string,
    @Query() query: GenerateAuthUrlQueryDto,
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
  ) {
    const authUrl = await this.integrationsService.generateAuthUrl(
      user.sub!,
      workspaceId,
      provider,
      query.scopes,
      query.targetType as any,
      query.returnUrl
    );
    return res.json({ authUrl });
  }

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

  @Delete(':provider')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke integration by provider (single-account)' })
  @ApiParam({ name: 'provider', enum: IntegrationProvider })
  async revokeByProvider(
    @Param('provider') provider: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.revokeConnection(user.sub!, provider);
  }

  @Delete('connections/:connectionId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke integration by connectionId (multi-account)' })
  async revokeByConnectionId(
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.revokeConnectionById(user.sub!, connectionId);
  }

  @Post('apikey/:provider')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save an API key manually for providers that do not use OAuth' })
  @ApiParam({ name: 'provider', enum: IntegrationProvider })
  @ApiBody({ schema: { type: 'object', properties: { apiKey: { type: 'string' } } } })
  async saveApiKey(
    @Param('workspaceId') workspaceId: string,
    @Param('provider') provider: string,
    @Body('apiKey') apiKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.saveApiKey(user.sub!, workspaceId, provider, apiKey);
  }
}
