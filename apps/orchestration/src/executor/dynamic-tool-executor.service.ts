import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DynamicToolRegistryService, DynamicProviderSpec } from '../registry/dynamic-tool-registry.service';
import { CallToolResponseDto } from '../dto/mcp.dto';
import { OpenAPIV3, OpenAPIV2 } from 'openapi-types';
import { OpenApiSecurityInjector } from './openapi-security.injector';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DynamicProviderEntity, EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';
import { buildTTL } from '@slack/common';
import { QueueService, EQueueName, EJobName } from '@slack/queue';
import { PiiScrubberUtil } from './pii-scrubber.util';
import { ResponseTruncatorUtil } from './response-truncator.util';

@Injectable()
export class DynamicToolExecutorService {
  private readonly logger = new Logger(DynamicToolExecutorService.name);

  constructor(
    private readonly registry: DynamicToolRegistryService,
    @InjectRepository(DynamicProviderEntity)
    private readonly providerRepo: Repository<DynamicProviderEntity>,
    private readonly queueService: QueueService,
  ) {}

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

      // 4. Inject Authentication using Smart Security Injector
      if (providerSpec.accessToken) {
        OpenApiSecurityInjector.inject(spec, operation, providerSpec.accessToken, headers, queryParams, providerSpec.authType);
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

      // 7. Response Truncation (Tránh nổ Context Window)
      safeData = ResponseTruncatorUtil.truncate(safeData);

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
    
    const expiresInMs = new Date(providerSpec.tokenExpiresAt).getTime() - Date.now();
    if (expiresInMs >= buildTTL('MINUTE', 5) || !providerSpec.refreshToken || !providerSpec.authConfig?.tokenUrl) return;

    this.logger.warn(`Token for provider "${providerId}" is expiring soon. Auto-renewing...`);
    try {
      const refreshRes = await axios.post(providerSpec.authConfig.tokenUrl, {
        grant_type: 'refresh_token',
        refresh_token: providerSpec.refreshToken,
        client_id: providerSpec.authConfig.clientId,
        client_secret: providerSpec.authConfig.clientSecret,
      }, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      providerSpec.accessToken = refreshRes.data.access_token;
      if (refreshRes.data.refresh_token) {
          providerSpec.refreshToken = refreshRes.data.refresh_token;
      }
      const expiresInSecs = refreshRes.data.expires_in || 3600;
      providerSpec.tokenExpiresAt = new Date(Date.now() + expiresInSecs * 1000);

      // Đẩy vào Queue để đảm bảo token được lưu xuống DB 100% (có retry)
      this.queueService.addJob(
        EQueueName.DYNAMIC_PROVIDER_QUEUE,
        EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        {
          providerId,
          accessToken: providerSpec.accessToken,
          refreshToken: providerSpec.refreshToken,
          tokenExpiresAt: providerSpec.tokenExpiresAt,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
        }
      ).catch(qErr => this.logger.error(`Failed to enqueue token update job: ${qErr.message}`));

      this.logger.log(`Successfully auto-renewed token for "${providerId}"`);
    } catch (refreshErr: any) {
      this.logger.error(`Failed to auto-renew token: ${refreshErr.message}`);
    }
  }

  private handleExecutionError(error: any): CallToolResponseDto {
    this.logger.error(`Error executing dynamic tool: ${error.message}`);
    
    let errorText = error.message;
    if (error.response) {
      errorText = `Status ${error.response.status}: ${
        typeof error.response.data === 'object' 
          ? JSON.stringify(error.response.data) 
          : error.response.data
      }`;
    }
    
    return this.formatErrorResponse(`API Request Failed: ${errorText}`);
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
