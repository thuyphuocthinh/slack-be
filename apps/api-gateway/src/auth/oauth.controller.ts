import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { OAuthService } from './oauth.service';
import { ChannelService } from '../channel/channel.service';
import { CurrentUser, type JwtUser, Public } from '@slack/common';
import {
  CreateOAuthClientDto,
  UpdateOAuthClientDto,
  GetOAuthAuthorizeDetailsDto,
  OAuthApproveConsentDto,
  OAuthTokenExchangeDto,
} from './dto/oauth.dto';

@ApiTags('OAuth 2.0 Provider')
@Controller('oauth')
@ApiBearerAuth()
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly channelService: ChannelService,
  ) {}

  // ================= DEVELOPER CONSOLE =================

  @Post('clients')
  @ApiOperation({ summary: 'Register a new OAuth Client/Application' })
  @ApiResponse({ status: 201, description: 'OAuth Client created successfully' })
  async createClient(
    @CurrentUser() user: JwtUser,
    @Body() data: CreateOAuthClientDto,
  ) {
    return this.oauthService.createClient(user.sub, data);
  }

  @Get('clients')
  @ApiOperation({ summary: 'Retrieve all OAuth Clients owned by the current user' })
  @ApiResponse({ status: 200, description: 'OAuth Clients retrieved successfully' })
  async getClients(@CurrentUser() user: JwtUser) {
    return this.oauthService.getClients(user.sub);
  }

  @Get('clients/:id')
  @ApiOperation({ summary: 'Get details of a specific OAuth Client' })
  @ApiResponse({ status: 200, description: 'OAuth Client details retrieved successfully' })
  async getClientDetails(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.oauthService.getClientDetails(user.sub, id);
  }

  @Patch('clients/:id')
  @ApiOperation({ summary: 'Update details of an OAuth Client' })
  @ApiResponse({ status: 200, description: 'OAuth Client updated successfully' })
  async updateClient(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() data: UpdateOAuthClientDto,
  ) {
    return this.oauthService.updateClient(user.sub, id, data);
  }

  @Post('clients/:id/secret')
  @ApiOperation({ summary: 'Regenerate the client secret for an OAuth Client' })
  @ApiResponse({ status: 200, description: 'Client secret regenerated successfully' })
  async regenerateClientSecret(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.oauthService.regenerateClientSecret(user.sub, id);
  }

  @Delete('clients/:id')
  @ApiOperation({ summary: 'Delete an OAuth Client' })
  @ApiResponse({ status: 200, description: 'OAuth Client deleted successfully' })
  async deleteClient(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.oauthService.deleteClient(user.sub, id);
  }

  // ================= OAUTH PROVIDER FLOW =================

  @Get('authorize')
  @ApiOperation({ summary: 'Retrieve OAuth consent details (Client Name, Scopes, Logo)' })
  @ApiResponse({ status: 200, description: 'Consent details retrieved' })
  async getAuthorizeDetails(@Query() query: GetOAuthAuthorizeDetailsDto) {
    return this.oauthService.getAuthorizeDetails(query);
  }

  @Post('approve')
  @ApiOperation({ summary: 'Approve consent and generate short-lived auth code' })
  @ApiResponse({ status: 200, description: 'Consent approved and code generated' })
  async approveConsent(
    @CurrentUser() user: JwtUser,
    @Body() data: OAuthApproveConsentDto,
  ) {
    return this.oauthService.approveConsent(user.sub, data);
  }

  @Public()
  @Post('token')
  @ApiOperation({ summary: 'Exchange authorization code for access and refresh tokens' })
  @ApiResponse({ status: 200, description: 'Tokens issued successfully' })
  async exchangeToken(@Body() data: OAuthTokenExchangeDto) {
    return this.oauthService.exchangeToken(data);
  }

  @Public()
  @Get('userinfo')
  @ApiOperation({ summary: 'Retrieve user details using OAuth access token' })
  @ApiResponse({ status: 200, description: 'UserInfo retrieved successfully' })
  async getUserInfo(@Req() req: Request) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const token = authHeader.substring(7);
    return this.oauthService.getUserInfo(token);
  }

  @Public()
  @Get('channels')
  @ApiOperation({ summary: 'Retrieve workspace channels using OAuth access token with channels:read scope' })
  @ApiResponse({ status: 200, description: 'Channels retrieved successfully' })
  async getChannels(
    @Req() req: Request,
    @Query('workspaceId') workspaceId: string,
  ) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const token = authHeader.substring(7);

    // 1. Verify token scope and get user id context
    const tokenInfo = await this.oauthService.verifyTokenScope(token, 'channels:read');

    // 2. Query workspace channels acting on behalf of the user
    return this.channelService.getChannels({
      workspaceId,
      memberId: tokenInfo.userId,
    });
  }
}
