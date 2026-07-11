import { Injectable, Logger } from '@nestjs/common';
import { DynamicToolRegistryService, DynamicProviderSpec } from '../registry/dynamic-tool-registry.service';
import { CallToolResponseDto } from '../dto/mcp.dto';
import { EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';
import { QueueService, EQueueName, EJobName } from '@slack/queue';
import { PiiScrubProcessor } from './pii-scrub.processor';
import {
  OpenApiSecurityInjector as LibSecurityInjector,
  Oauth2RefreshTokenRefresher,
  TruncateResponseProcessor,
  DynamicToolExecutorService as LibDynamicToolExecutorService,
  ToolNotFoundError,
  ToolExecutionError,
  ResponseProcessingError,
  DynamicProviderAuthType as ELibAuthType,
  ObservabilityHooks,
} from '../common/agentic-openapi-parser';

@Injectable()
export class DynamicToolExecutorService {
  private readonly logger = new Logger(DynamicToolExecutorService.name);
  // agentic-openapi-parser: swapped-in mechanisms (parity confirmed against the code they replace)
  private readonly securityInjector = new LibSecurityInjector();
  private readonly responseProcessors = [new PiiScrubProcessor(), new TruncateResponseProcessor()];
  // Delegates HTTP request building, security injection, retry/backoff, and response processing —
  // this is the same executor class the library's own test suite is built against.
  private readonly libExecutor = new LibDynamicToolExecutorService(this.securityInjector, this.logger);

  constructor(
    private readonly registry: DynamicToolRegistryService,
    private readonly queueService: QueueService,
  ) { }

  /**
   * Nhận Tool Call từ LLM và thực thi HTTP request dựa trên OpenAPI spec.
   */
  async execute(
    providerId: string,
    toolName: string,
    args: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site parity (mcp-client.service.ts passes dto.ownerId); not wired to anything yet, unchanged from before this refactor
    ownerId?: string,
  ): Promise<CallToolResponseDto> {
    try {
      this.logger.log(`Executing dynamic tool "${toolName}" for provider "${providerId}"`);

      const providerSpec = await this.registry.getProviderSpec(providerId);
      const spec = providerSpec.document as unknown as Record<string, unknown>;

      // Token Auto-Renew (OAuth2) — unchanged: still mutates the cached providerSpec in place so
      // subsequent calls within the registry's cache TTL reuse the refreshed token immediately.
      await this.handleOAuth2AutoRenew(providerId, providerSpec);

      const data = await this.libExecutor.execute(spec, toolName, args, {
        accessToken: providerSpec.accessToken,
        authType: providerSpec.authType as unknown as ELibAuthType,
        timeout: 15000,
        responseProcessors: this.responseProcessors,
        retry: { maxRetries: 2 },
        hooks: this.buildHooks(),
      });

      const responseText = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      return {
        isError: false,
        content: [{ type: 'text', text: responseText }],
      };
    } catch (error: unknown) {
      return this.handleExecutionError(error, toolName, providerId);
    }
  }

  private buildHooks(): ObservabilityHooks {
    return {
      onRetry: ({ toolName, attempt, statusCode, delayMs }) =>
        this.logger.warn(
          `Tool "${toolName}" attempt ${attempt} failed (status ${statusCode ?? 'network error'}), retrying in ${Math.round(delayMs)}ms`,
        ),
    };
  }

  private async handleOAuth2AutoRenew(providerId: string, providerSpec: DynamicProviderSpec) {
    if (providerSpec.authType !== EDynamicProviderAuthType.OAUTH2 || !providerSpec.tokenExpiresAt) return;

    // agentic-openapi-parser: mirrors this method's previous inline logic exactly (5-minute
    // threshold, refresh_token grant POST, swallow-and-log on failure). A fresh instance is
    // created per call so `onRefreshed` can close over this specific `providerId` for the queue job.
    const refresher = new Oauth2RefreshTokenRefresher({
      onRefreshed: (newState) => {
        this.queueService
          .addJob(
            EQueueName.DYNAMIC_PROVIDER_QUEUE,
            EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
            {
              providerId,
              accessToken: newState.accessToken,
              refreshToken: newState.refreshToken,
              tokenExpiresAt: newState.tokenExpiresAt,
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 1000 },
              removeOnComplete: true,
            },
          )
          .catch((qErr: any) => this.logger.error(`Failed to enqueue token update job: ${qErr.message}`));
      },
    });

    const newState = await refresher.refreshIfNeeded({
      accessToken: providerSpec.accessToken!,
      refreshToken: providerSpec.refreshToken,
      tokenExpiresAt: providerSpec.tokenExpiresAt,
      tokenUrl: providerSpec.authConfig?.tokenUrl,
      clientId: providerSpec.authConfig?.clientId,
      clientSecret: providerSpec.authConfig?.clientSecret,
    });

    // Mutate the cached DynamicProviderSpec in place — DynamicToolRegistryService.getProviderSpec()
    // returns the same object reference from its RAM cache, so this keeps subsequent calls within
    // the cache TTL using the refreshed token without needing a DB round-trip.
    if (newState) {
      providerSpec.accessToken = newState.accessToken;
      providerSpec.refreshToken = newState.refreshToken;
      providerSpec.tokenExpiresAt = newState.tokenExpiresAt;
      this.logger.log(`Successfully auto-renewed token for "${providerId}"`);
    }
  }

  private handleExecutionError(error: unknown, toolName: string, providerId: string): CallToolResponseDto {
    if (error instanceof ToolNotFoundError) {
      return this.formatErrorResponse(`Tool "${toolName}" not found in spec for provider "${providerId}"`);
    }

    if (error instanceof ToolExecutionError || error instanceof ResponseProcessingError) {
      this.logger.error(`Error executing dynamic tool: ${error.message}`);
      return this.formatErrorResponse(error.message);
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Unexpected error executing dynamic tool "${toolName}": ${message}`);
    return this.formatErrorResponse(message);
  }

  private formatErrorResponse(message: string): CallToolResponseDto {
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
    };
  }
}
