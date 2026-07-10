import { Logger } from '@nestjs/common';

import { EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';

/**
 * @deprecated Not called anymore — dynamic-tool-executor.service.ts now uses
 * agentic-openapi-parser's OpenApiSecurityInjector (services subpath) instead, which
 * reimplements this exact logic. Kept here for reference only; safe to delete once confirmed
 * unneeded.
 */
export class OpenApiSecurityInjector {
  private static readonly logger = new Logger(OpenApiSecurityInjector.name);

  /**
   * Tự động phân tích cấu trúc OpenAPI/Swagger để bơm API Key vào đúng vị trí (Header, Query, Bearer, Basic...)
   */
  static inject(
    spec: any,
    operation: any,
    accessToken: string,
    headers: Record<string, string>,
    queryParams: Record<string, any>,
    authType?: EDynamicProviderAuthType
  ): void {
    if (!accessToken) return;
    accessToken = accessToken.trim();

    // 1. Tìm các yêu cầu bảo mật áp dụng cho Endpoint này (ưu tiên operation > global)
    const activeSecurities = operation.security || spec.security;
    
    // Nếu endpoint được đánh dấu là không cần auth (VD: security: []), thì không inject
    if (activeSecurities && activeSecurities.length === 0) {
       this.logger.debug('Endpoint explicitly disables security. Skipping injection.');
       return;
    }

    // 2. Tìm kho chứa định nghĩa bảo mật (Security Definitions/Schemes)
    const securitySchemes = spec.components?.securitySchemes || spec.securityDefinitions || {};

    // 3. Nếu không có định nghĩa nào trong file Swagger, ép dùng theo authType
    if (Object.keys(securitySchemes).length === 0) {
       this.logger.debug('No securitySchemes found in spec. Forcing auth by user selection.');
       this.forceInjectByAuthType(accessToken, headers, queryParams, authType);
       return;
    }

    // 4. Nếu có yêu cầu bảo mật cụ thể, tìm scheme phù hợp để inject
    let injected = false;

    // Lặp qua danh sách các bộ security được phép dùng cho endpoint này
    const securitiesToCheck = activeSecurities || [{}]; // Nếu undefined, rà quét thử tất cả schemes
    
    for (const secRequirement of securitiesToCheck) {
      // secRequirement là dạng { "ApiKeyAuth": [] }
      const schemeNames = Object.keys(secRequirement);
      
      // Nếu undefined (fallback), duyệt hết schemes
      const namesToCheck = schemeNames.length > 0 ? schemeNames : Object.keys(securitySchemes);

      for (const schemeName of namesToCheck) {
        const scheme = securitySchemes[schemeName];
        if (!scheme) continue;

        // Xử lý theo từng loại Authentication có xét đến authType của user
        if (scheme.type === 'apiKey' && (authType === EDynamicProviderAuthType.API_KEY || !authType)) {
          if (scheme.in === 'header') {
            let finalToken = accessToken;
            // Hack for TMDB and others: if the header is 'Authorization', it often requires 'Bearer ' prefix 
            // even if the scheme is incorrectly defined as 'apiKey' in the Swagger document.
            if (scheme.name.toLowerCase() === 'authorization' && !accessToken.toLowerCase().startsWith('bearer ') && !accessToken.toLowerCase().startsWith('basic ')) {
              if (accessToken.startsWith('eyJ') || (scheme as any)['x-bearer-format']?.toLowerCase() === 'bearer') {
                finalToken = `Bearer ${accessToken}`;
              }
            }
            headers[scheme.name] = finalToken;
            injected = true;
          } else if (scheme.in === 'query') {
            queryParams[scheme.name] = accessToken;
            injected = true;
          }
        } 
        else if (scheme.type === 'http' && (authType === EDynamicProviderAuthType.BEARER || authType === EDynamicProviderAuthType.BASIC || !authType)) {
          if (scheme.scheme?.toLowerCase() === 'bearer' && (authType === EDynamicProviderAuthType.BEARER || !authType)) {
            headers['Authorization'] = `Bearer ${accessToken}`;
            injected = true;
          } else if (scheme.scheme?.toLowerCase() === 'basic' && (authType === EDynamicProviderAuthType.BASIC || !authType)) {
            const isBase64 = Buffer.from(accessToken, 'base64').toString('base64') === accessToken;
            const encoded = isBase64 ? accessToken : Buffer.from(accessToken).toString('base64');
            headers['Authorization'] = `Basic ${encoded}`;
            injected = true;
          }
        }
        else if ((scheme.type === 'oauth2' || scheme.type === 'openIdConnect') && (authType === EDynamicProviderAuthType.OAUTH2 || authType === EDynamicProviderAuthType.BEARER || !authType)) {
          headers['Authorization'] = `Bearer ${accessToken}`;
          injected = true;
        }
        else if (scheme.type === 'basic' && (authType === EDynamicProviderAuthType.BASIC || !authType)) {
          const isBase64 = Buffer.from(accessToken, 'base64').toString('base64') === accessToken;
          const encoded = isBase64 ? accessToken : Buffer.from(accessToken).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
          injected = true;
        }

        if (injected) {
          this.logger.debug(`Successfully injected API Key using scheme: ${schemeName} (Type: ${scheme.type})`);
          break; // Chỉ cần inject thành công 1 scheme là đủ cho request này
        }
      }
      
      if (injected) break;
    }

    // 5. Nếu quét hết mà vẫn không inject được gì (do Swagger viết sai/thiếu), ép Fallback theo authType
    if (!injected) {
       this.logger.warn('Could not match any security scheme. Forcing auth by user selection.');
       this.forceInjectByAuthType(accessToken, headers, queryParams, authType);
    }
  }

  private static forceInjectByAuthType(
    accessToken: string,
    headers: Record<string, string>,
    queryParams: Record<string, any>,
    authType?: EDynamicProviderAuthType
  ): void {
    if (authType === EDynamicProviderAuthType.NONE) return;

    if (authType === EDynamicProviderAuthType.API_KEY) {
      // Fallback: TMDB and many others use api_key or apiKey in query. We could put in header but query is safer if not known.
      queryParams['api_key'] = accessToken;
    } else if (authType === EDynamicProviderAuthType.BASIC) {
      const isBase64 = Buffer.from(accessToken, 'base64').toString('base64') === accessToken;
      const encoded = isBase64 ? accessToken : Buffer.from(accessToken).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    } else {
      // BEARER, OAUTH2, or unknown
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
  }
}
