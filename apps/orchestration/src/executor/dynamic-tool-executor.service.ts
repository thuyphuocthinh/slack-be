import { Injectable, Logger } from '@nestjs/common';
import {
  DynamicToolRegistryService,
  DynamicProviderSpec,
} from '../registry/dynamic-tool-registry.service';
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
import { inferOAuth2RefreshFormat } from '../common/oauth2-refresh-format.util';

@Injectable()
export class DynamicToolExecutorService {
  private readonly logger = new Logger(DynamicToolExecutorService.name);
  // agentic-openapi-parser: swapped-in mechanisms (parity confirmed against the code they replace)
  private readonly securityInjector = new LibSecurityInjector();
  private readonly responseProcessors = [
    new PiiScrubProcessor(),
    new TruncateResponseProcessor(),
  ];
  // Delegates HTTP request building, security injection, retry/backoff, and response processing —
  // this is the same executor class the library's own test suite is built against.
  private readonly libExecutor = new LibDynamicToolExecutorService(
    this.securityInjector,
    this.logger,
  );

  constructor(
    private readonly registry: DynamicToolRegistryService,
    private readonly queueService: QueueService,
  ) {}

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
      this.logger.log(
        `Executing dynamic tool "${toolName}" for provider "${providerId}"`,
      );

      const providerSpec = await this.registry.getProviderSpec(providerId);
      const spec = providerSpec.document as unknown as Record<string, unknown>;

      const data = await this.executeWithReactiveRenew(
        providerId,
        providerSpec,
        spec,
        toolName,
        args,
      );

      const responseText =
        typeof data === 'string' ? data : JSON.stringify(data, null, 2);

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

  private callTool(
    spec: Record<string, unknown>,
    toolName: string,
    args: Record<string, unknown>,
    providerSpec: DynamicProviderSpec,
  ): Promise<unknown> {
    return this.libExecutor.execute(spec, toolName, args, {
      accessToken: providerSpec.accessToken,
      authType: providerSpec.authType as unknown as ELibAuthType,
      timeout: 15000,
      responseProcessors: this.responseProcessors,
      retry: { maxRetries: 2 },
      hooks: this.buildHooks(),
    });
  }

  // Reactive OAuth2 renew: thay vì đoán trước khi nào token hết hạn (theo dõi tokenExpiresAt,
  // tin vào "expires_in" của provider), chỉ refresh khi tool call vừa thật sự bị 401 — đơn giản
  // hơn, không cần lưu/đồng bộ thời điểm hết hạn, không lo lệch giờ server.
  private async executeWithReactiveRenew(
    providerId: string,
    providerSpec: DynamicProviderSpec,
    spec: Record<string, unknown>,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.callTool(spec, toolName, args, providerSpec);
    } catch (error) {
      if (
        !this.isUnauthorized(error) ||
        !(await this.tryRenewOAuth2Token(providerId, providerSpec))
      ) {
        throw error;
      }
      // Token vừa được refresh — thử lại đúng 1 lần với accessToken mới.
      return this.callTool(spec, toolName, args, providerSpec);
    }
  }

  private isUnauthorized(error: unknown): boolean {
    return error instanceof ToolExecutionError && error.statusCode === 401;
  }

  private async tryRenewOAuth2Token(
    providerId: string,
    providerSpec: DynamicProviderSpec,
  ): Promise<boolean> {
    if (
      providerSpec.authType !== EDynamicProviderAuthType.OAUTH2 ||
      !providerSpec.refreshToken ||
      !providerSpec.authConfig?.tokenUrl
    ) {
      return false;
    }

    // agentic-openapi-parser: mirrors the refresh_token grant POST + swallow-and-log-on-failure
    // behavior this method always had. A fresh instance is created per call so `onRefreshed` can
    // close over this specific `providerId` for the queue job.
    // requestFormat: dùng giá trị đã lưu ở lúc đăng ký; provider tạo trước khi tính năng này ra
    // đời sẽ chưa có field này trong authConfig nên tự suy ra lại từ tokenUrl (fallback an toàn).
    const requestFormat =
      providerSpec.authConfig?.refreshRequestFormat ??
      inferOAuth2RefreshFormat(providerSpec.authConfig?.tokenUrl);
    const refresher = new Oauth2RefreshTokenRefresher({
      requestFormat,
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
          .catch((qErr: any) =>
            this.logger.error(
              `Failed to enqueue token update job: ${qErr.message}`,
            ),
          );
      },
    });

    const newState = await refresher.refreshIfNeeded({
      accessToken: providerSpec.accessToken!,
      refreshToken: providerSpec.refreshToken,
      tokenExpiresAt: new Date(0), // ép refresh — tool call vừa 401 nên chắc chắn cần refresh
      tokenUrl: providerSpec.authConfig.tokenUrl,
      clientId: providerSpec.authConfig.clientId,
      clientSecret: providerSpec.authConfig.clientSecret,
    });

    // Mutate the cached DynamicProviderSpec in place — DynamicToolRegistryService.getProviderSpec()
    // returns the same object reference from its RAM cache, so this keeps subsequent calls within
    // the cache TTL using the refreshed token without needing a DB round-trip.
    if (!newState) return false;

    providerSpec.accessToken = newState.accessToken;
    providerSpec.refreshToken = newState.refreshToken;
    providerSpec.tokenExpiresAt = newState.tokenExpiresAt;
    this.logger.log(
      `Successfully renewed OAuth2 token for "${providerId}" after a 401`,
    );
    return true;
  }

  private handleExecutionError(
    error: unknown,
    toolName: string,
    providerId: string,
  ): CallToolResponseDto {
    if (error instanceof ToolNotFoundError) {
      return this.formatErrorResponse(
        `Tool "${toolName}" not found in spec for provider "${providerId}"`,
      );
    }

    if (
      error instanceof ToolExecutionError ||
      error instanceof ResponseProcessingError
    ) {
      this.logger.error(`Error executing dynamic tool: ${error.message}`);
      return this.formatErrorResponse(error.message);
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `Unexpected error executing dynamic tool "${toolName}": ${message}`,
    );
    return this.formatErrorResponse(message);
  }

  private formatErrorResponse(message: string): CallToolResponseDto {
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
    };
  }
}
