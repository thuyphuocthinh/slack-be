import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DynamicToolRegistryService, DynamicProviderSpec } from '../registry/dynamic-tool-registry.service';
import { CallToolResponseDto } from '../dto/mcp.dto';
import { OpenAPIV3, OpenAPIV2 } from 'openapi-types';
import { EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';
import { QueueService, EQueueName, EJobName } from '@slack/queue';
import { PiiScrubberUtil } from './pii-scrubber.util';
import {
  OpenApiSecurityInjector as LibSecurityInjector,
  Oauth2RefreshTokenRefresher,
  TruncateResponseProcessor,
  DynamicProviderAuthType as ELibAuthType,
} from '../common/agentic-openapi-parser';

@Injectable()
export class DynamicToolExecutorService {
  private readonly logger = new Logger(DynamicToolExecutorService.name);
  // agentic-openapi-parser: swapped-in mechanisms (parity confirmed against the code they replace)
  private readonly securityInjector = new LibSecurityInjector();
  private readonly responseTruncator = new TruncateResponseProcessor();

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
    ownerId?: string,
  ): Promise<CallToolResponseDto> {
    try {
      this.logger.log(`Executing dynamic tool "${toolName}" for provider "${providerId}"`);

      const providerSpec = await this.registry.getProviderSpec(providerId);
      const spec = providerSpec.document;
      const operationInfo = this.findOperationByToolName(spec, toolName);

      if (!operationInfo) {
        return this.formatErrorResponse(`Tool "${toolName}" not found in spec for provider "${providerId}"`);
      }

      const { path, method, operation } = operationInfo;

      // 1. Determine Base URL & Build Params
      const baseUrl = this.getBaseUrl(spec);
      const { requestUrl, queryParams, headers } = this.buildRequestParams(baseUrl, path, operation, args);

      // 2. Extract Body
      const requestBody = args.requestBody;

      // 3. Token Auto-Renew (OAuth2)
      await this.handleOAuth2AutoRenew(providerId, providerSpec);

      // 4. Inject Authentication using Smart Security Injector (agentic-openapi-parser)
      if (providerSpec.accessToken) {
        this.securityInjector.inject(
          spec as unknown as Record<string, unknown>,
          operation,
          providerSpec.accessToken,
          headers,
          queryParams,
          providerSpec.authType as unknown as ELibAuthType,
        );
      }

      // 5. Chuẩn bị Axios Request
      this.logger.debug(`[${method.toUpperCase()}] Requesting: ${requestUrl}`);

      const response = await axios({
        method: method as any,
        url: requestUrl,
        params: queryParams,
        data: requestBody,
        headers,
        timeout: 15000,
      });

      // 6. PII Scrubbing (Bảo mật dữ liệu nhạy cảm)
      let safeData = PiiScrubberUtil.scrub(response.data);

      // 7. Response Truncation (Tránh nổ Context Window) — agentic-openapi-parser
      safeData = this.responseTruncator.process(safeData) as any;

      // 8. Format success response for LLM
      const responseText = typeof safeData === 'string'
        ? safeData
        : JSON.stringify(safeData, null, 2);

      return {
        isError: false,
        content: [{ type: 'text', text: responseText }]
      };
    } catch (error: any) {
      return this.handleExecutionError(error);
    }
  }

  private getBaseUrl(spec: any): string {
    if ((spec as OpenAPIV3.Document).servers?.length) {
      let baseUrl = (spec as OpenAPIV3.Document).servers![0].url;
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
      return baseUrl;
    } else if ((spec as OpenAPIV2.Document).host) {
      const v2 = spec as OpenAPIV2.Document;
      const scheme = v2.schemes?.length ? v2.schemes[0] : 'https';
      return `${scheme}://${v2.host}${v2.basePath || ''}`;
    }
    return '';
  }

  private buildRequestParams(
    baseUrl: string,
    path: string,
    operation: any,
    args: Record<string, unknown>
  ) {
    let requestUrl = `${baseUrl}${path}`;
    const queryParams: Record<string, any> = {};
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (operation.parameters && Array.isArray(operation.parameters)) {
      for (const p of operation.parameters as OpenAPIV3.ParameterObject[]) {
        const val = args[p.name];
        if (val !== undefined && val !== null) {
          if (p.in === 'path') {
            requestUrl = requestUrl.replace(`{${p.name}}`, String(val));
          } else if (p.in === 'query') {
            queryParams[p.name] = val;
          } else if (p.in === 'header') {
            headers[p.name] = String(val);
          }
        }
      }
    }
    return { requestUrl, queryParams, headers };
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

  private handleExecutionError(error: any): CallToolResponseDto {
    this.logger.error(`Error executing dynamic tool: ${error.message}`);

    const status = error.response?.status;
    const data = error.response?.data;
    const reqConfig = error.config;

    // Mask the sensitive token in the debug output
    let safeHeaders = { ...reqConfig?.headers };
    if (safeHeaders['Authorization']) {
      const authVal = String(safeHeaders['Authorization']);
      if (authVal.toLowerCase().startsWith('bearer ')) {
        safeHeaders['Authorization'] = 'Bearer ***';
      } else if (authVal.toLowerCase().startsWith('basic ')) {
        safeHeaders['Authorization'] = 'Basic ***';
      } else {
        safeHeaders['Authorization'] = '*** (No Prefix / Raw Token)';
      }
    }

    let safeParams = { ...reqConfig?.params };
    if (safeParams['api_key']) safeParams['api_key'] = '***';

    const debugInfo = {
      url: reqConfig?.url,
      params: safeParams,
      headers: safeHeaders,
    };

    const errorText = `API Request Failed: Status ${status}: ${typeof data === 'object' ? JSON.stringify(data) : data
      }\nRequest Sent: ${JSON.stringify(debugInfo)}`;

    return this.formatErrorResponse(errorText);
  }

  /**
   * Helper function: Tìm ngược lại Endpoint dựa trên toolName
   */
  private findOperationByToolName(spec: any, targetToolName: string) {
    const paths = spec.paths || {};
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;
      for (const method of methods) {
        const operation = (pathItem as any)[method];
        if (!operation) continue;

        const rawName = operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const generatedName = rawName
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .replace(/_+/g, '_')
          .substring(0, 64)
          .replace(/^_+|_+$/g, '') || 'unknown_tool';

        if (generatedName === targetToolName) {
          return { path, method, operation };
        }
      }
    }
    return null;
  }

  private formatErrorResponse(message: string): CallToolResponseDto {
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
    };
  }
}
