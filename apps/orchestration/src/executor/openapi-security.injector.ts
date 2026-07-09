import { Logger } from '@nestjs/common';

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
    queryParams: Record<string, any>
  ): void {
    if (!accessToken) return;

    // 1. Tìm các yêu cầu bảo mật áp dụng cho Endpoint này (ưu tiên operation > global)
    const activeSecurities = operation.security || spec.security;
    
    // Nếu endpoint được đánh dấu là không cần auth (VD: security: []), thì không inject
    if (activeSecurities && activeSecurities.length === 0) {
       this.logger.debug('Endpoint explicitly disables security. Skipping injection.');
       return;
    }

    // 2. Tìm kho chứa định nghĩa bảo mật (Security Definitions/Schemes)
    const securitySchemes = spec.components?.securitySchemes || spec.securityDefinitions || {};

    // 3. Nếu không có định nghĩa nào trong file Swagger, fallback về Bearer mặc định cho an toàn
    if (Object.keys(securitySchemes).length === 0) {
       this.logger.debug('No securitySchemes found in spec. Fallback to Bearer token.');
       headers['Authorization'] = `Bearer ${accessToken}`;
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

        // Xử lý theo từng loại Authentication
        if (scheme.type === 'apiKey') {
          if (scheme.in === 'header') {
            headers[scheme.name] = accessToken;
            injected = true;
          } else if (scheme.in === 'query') {
            queryParams[scheme.name] = accessToken;
            injected = true;
          }
        } 
        else if (scheme.type === 'http') {
          if (scheme.scheme?.toLowerCase() === 'bearer') {
            headers['Authorization'] = `Bearer ${accessToken}`;
            injected = true;
          } else if (scheme.scheme?.toLowerCase() === 'basic') {
            // Giả định accessToken chứa sẵn username:password, nếu chưa có base64 thì encode
            const isBase64 = Buffer.from(accessToken, 'base64').toString('base64') === accessToken;
            const encoded = isBase64 ? accessToken : Buffer.from(accessToken).toString('base64');
            headers['Authorization'] = `Basic ${encoded}`;
            injected = true;
          }
        }
        else if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
          headers['Authorization'] = `Bearer ${accessToken}`;
          injected = true;
        }
        else if (scheme.type === 'basic') {
          // OAS 2.0 basic auth
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

    // 5. Nếu quét hết mà vẫn không inject được gì (do Swagger viết sai/thiếu), ép Fallback Bearer
    if (!injected) {
       this.logger.warn('Could not match any security scheme. Fallback to Bearer token.');
       headers['Authorization'] = `Bearer ${accessToken}`;
    }
  }
}
