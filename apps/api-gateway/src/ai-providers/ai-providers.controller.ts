import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '@slack/common';
import { AiProvidersService } from './ai-providers.service';
import { SubmitProviderCredentialsDto } from './dto/submit-provider-credentials.dto';
import { ResolveApprovalDto } from './dto/resolve-approval.dto';
import { TriggerPromptDto } from './dto/trigger-prompt.dto';
import { RegisterDynamicProviderDto } from './dto/register-dynamic-provider.dto';
import { RateLimit } from '../common/guards/rate-limit.decorator';

@ApiTags('ai-providers')
@ApiBearerAuth()
@Controller('ai-providers')
export class AiProvidersController {
  constructor(private readonly aiProvidersService: AiProvidersService) {}

  @Get()
  @ApiOperation({
    summary: 'List all providers with connect status + tools they unlock',
  })
  async getProviders(@CurrentUser() user: JwtUser) {
    return this.aiProvidersService.getProviders(user.sub);
  }

  @Post(':provider/connect')
  @ApiOperation({
    summary: 'Initiate connect flow for a provider (oauth url or form fields)',
  })
  async connect(
    @Param('provider') provider: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiProvidersService.connect(user.sub, provider);
  }

  @Post(':provider/submit')
  @ApiOperation({ summary: 'Submit form/api_key credentials for a provider' })
  async submit(
    @Param('provider') provider: string,
    @Body() dto: SubmitProviderCredentialsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiProvidersService.submitCredentials(
      user.sub,
      provider,
      dto.credentials,
    );
  }

  @Delete(':provider')
  @ApiOperation({ summary: 'Disconnect a provider' })
  async disconnect(
    @Param('provider') provider: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiProvidersService.disconnect(user.sub, provider);
  }

  @Post('approvals/:messageId')
  @RateLimit({ limit: 10, window: 60 })
  @ApiOperation({
    summary:
      'Approve or reject a pending risky-tool action (HITL, Giai đoạn 3)',
  })
  async resolveApproval(
    @Param('messageId') messageId: string,
    @Body() dto: ResolveApprovalDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiProvidersService.resolveApproval(
      user.sub,
      messageId,
      dto.action,
    );
  }

  @Post(':provider/prompts')
  @ApiOperation({ summary: 'Trigger a prompt template to get the resulting text' })
  async triggerPrompt(
    @Param('provider') provider: string,
    @Body() dto: TriggerPromptDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiProvidersService.triggerPrompt(
      user.sub,
      provider,
      dto.name,
      dto.args,
    );
  }

  @Post('dynamic')
  @ApiOperation({ summary: 'Register a new dynamic custom Swagger provider' })
  async registerDynamicProvider(
    @Body() dto: RegisterDynamicProviderDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiProvidersService.registerDynamicProvider(
      user.sub,
      dto.name,
      dto.specUrl,
      dto.apiKey,
    );
  }

  @Delete('dynamic/:providerId')
  @ApiOperation({ summary: 'Delete a dynamic custom Swagger provider' })
  async deleteDynamicProvider(
    @Param('providerId') providerId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiProvidersService.deleteDynamicProvider(user.sub, providerId);
  }
}
