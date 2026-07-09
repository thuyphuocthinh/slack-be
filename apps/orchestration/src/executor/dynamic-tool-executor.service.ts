import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DynamicToolRegistryService } from '../registry/dynamic-tool-registry.service';
import { CallToolResponseDto } from '../dto/mcp.dto';
import { OpenAPIV3, OpenAPIV2 } from 'openapi-types';

@Injectable()
export class DynamicToolExecutorService {
  private readonly logger = new Logger(DynamicToolExecutorService.name);

  constructor(
    private readonly registry: DynamicToolRegistryService,
    // TODO: Bỏ comment khi McpAuthClientService hỗ trợ hàm getCredentials() cho Dynamic Swagger
    // private readonly mcpAuthClient: McpAuthClientService,
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
      
      // 1. Determine Base URL
      let baseUrl = '';
      if ((spec as OpenAPIV3.Document).servers?.length) {
         baseUrl = (spec as OpenAPIV3.Document).servers![0].url;
         // Remove trailing slash if exists
         if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
      } else if ((spec as OpenAPIV2.Document).host) {
         const v2 = spec as OpenAPIV2.Document;
         const scheme = v2.schemes?.length ? v2.schemes[0] : 'https';
         baseUrl = `${scheme}://${v2.host}${v2.basePath || ''}`;
      }
      
      // 2. Map arguments to Path, Query, Header
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

      // 3. Extract Body
      let requestBody: any = undefined;
      if (args.requestBody) {
         requestBody = args.requestBody;
      }

      // 4. Inject Authentication
      if (providerSpec.apiKey) {
        // Tùy theo Swagger, nhưng đa số dùng Bearer. Nếu là Custom API Key Header thì cần logic nâng cao hơn,
        // tạm thời mặc định là Authorization: Bearer cho các API thông dụng.
        headers['Authorization'] = `Bearer ${providerSpec.apiKey}`;
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

      // 6. Format success response for LLM
      const responseText = typeof response.data === 'string' 
        ? response.data 
        : JSON.stringify(response.data, null, 2);

      return {
        isError: false,
        content: [{ type: 'text', text: responseText }]
      };
    } catch (error: any) {
      this.logger.error(`Error executing dynamic tool: ${error.message}`);
      
      let errorText = error.message;
      if (error.response) {
        errorText = `Status ${error.response.status}: ${
          typeof error.response.data === 'object' 
            ? JSON.stringify(error.response.data) 
            : error.response.data
        }`;
      }
      
      // Trả về error format của MCP (không throw Error exception để LLM biết đường tự correct)
      return this.formatErrorResponse(`API Request Failed: ${errorText}`);
    }
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
