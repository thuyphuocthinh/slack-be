import { McpToolDto, McpResourceDto, McpPromptDto } from './mcp.dto';
import { EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';
import { EApprovalAction, ERefreshFormat } from '@slack/constants';

export class GetProvidersRequestDto {
  userId: string;
}

export class ProviderSummaryDto {
  provider: string;
  label: string;
  description: string;
  isConnected: boolean;
  tools: McpToolDto[];
  resources: McpResourceDto[];
  prompts: McpPromptDto[];
  isDynamic?: boolean;
  hasAuth?: boolean;
  authType?: EDynamicProviderAuthType;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  hasTokenUrl?: boolean;
}

export class InitiateConnectProviderRequestDto {
  userId: string;
  provider: string;
}

export class SubmitProviderCredentialsRequestDto {
  userId: string;
  provider: string;
  credentials: Record<string, string>;
}

export class SubmitProviderCredentialsResponseDto {
  success: boolean;
}

export class DisconnectProviderRequestDto {
  userId: string;
  provider: string;
}

export class DisconnectProviderResponseDto {
  success: boolean;
}

export class ResolveApprovalRequestDto {
  userId: string;
  messageId: string;
  action: EApprovalAction;
  selectedProvider?: string;
  editedArgs?: Record<string, any>;
}

export class ResolveApprovalResponseDto {
  success: boolean;
}

// messageId ở đây là reply messageId của BOT (cùng ID stream token/tool-call
// đang dùng xuyên suốt), KHÔNG phải messageId gốc user hỏi ban đầu.
export class CancelTurnRequestDto {
  userId: string;
  messageId: string;
}

export class CancelTurnResponseDto {
  success: boolean;
}

export class TriggerPromptRequestDto {
  userId: string;
  provider: string;
  name: string;
  args: Record<string, string>;
}

export class TriggerPromptResponseDto {
  text: string;
}

export class DynamicProviderDto {
  id: string;
  userId: string;
  name: string;
  specUrl: string;
  description?: string;
  hasAuth: boolean;
  authType: EDynamicProviderAuthType;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasTokenUrl: boolean;
  tokenExpiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class RegisterDynamicProviderRequestDto {
  userId: string;
  name: string;
  specUrl: string;
  description?: string;

  /**
   * Đóng vai trò là "Chìa khoá chính" (Primary Secret).
   * Lưu trữ API Key, Basic Auth credentials, hoặc OAuth2 Access Token tuỳ thuộc vào authType.
   */
  accessToken?: string;
  authType?: EDynamicProviderAuthType;

  // Chỉ dùng khi authType = OAUTH2 — thiếu refreshToken hoặc tokenUrl thì sẽ không bao giờ tự
  // refresh được (không auto-renew, không eager-refresh lúc đăng ký).
  refreshToken?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  /** Ghi đè thủ công định dạng body khi gọi refresh_token grant — để trống thì server tự suy ra
   *  từ tokenUrl (VD: auth.atlassian.com -> 'json'), mặc định 'form' cho các trường hợp còn lại. */
  refreshRequestFormat?: ERefreshFormat;

  // Escape hatch — chỉ cần khi hệ thống refresh trả về response quá khác biệt mà auto-detection
  // (snake_case/camelCase/envelope 1 lớp) không đoán ra được. Để trống ở tuyệt đại đa số trường hợp.
  responseAccessTokenPath?: string;
  responseRefreshTokenPath?: string;
  responseExpiresInPath?: string;
  defaultExpiresInSecs?: number;
}

export class RegisterDynamicProviderResponseDto {
  id: string;
  success: boolean;
}

// Cập nhật (reconnect) 1 dynamic provider đã tồn tại — mọi field đều optional theo đúng ngữ nghĩa
// PATCH: để trống thì giữ nguyên giá trị cũ (đặc biệt quan trọng cho secret — user không cần dán
// lại accessToken/clientSecret nếu chỉ muốn đổi refreshToken chẳng hạn).
export class UpdateDynamicProviderRequestDto {
  userId: string;
  providerId: string;
  name?: string;
  specUrl?: string;
  description?: string;
  accessToken?: string;
  authType?: EDynamicProviderAuthType;
  refreshToken?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  refreshRequestFormat?: ERefreshFormat;
  responseAccessTokenPath?: string;
  responseRefreshTokenPath?: string;
  responseExpiresInPath?: string;
  defaultExpiresInSecs?: number;
}

export class UpdateDynamicProviderResponseDto {
  id: string;
  success: boolean;
}

export class DeleteDynamicProviderRequestDto {
  userId: string;
  providerId: string;
}

export class DeleteDynamicProviderResponseDto {
  success: boolean;
}

// Backpressure/Admission control, mục 3 — gọi qua TCP vì orchestration không
// có HTTP surface riêng (thuần microservice). "degraded" khi redis HOẶC
// database không phản hồi — vẫn trả về (không throw) để caller tự quyết định
// alert/thử lại, không phải 1 lỗi request.
export class HealthCheckResponseDto {
  status: 'ok' | 'degraded';
  redis: boolean;
  database: boolean;
  circuitBreakers: Record<string, 'open' | 'halfOpen' | 'closed'>;
  queueDepth: Record<string, number>;
}

// Prometheus exposition format (text/plain) của registry RIÊNG của
// orchestration — api-gateway ghép thẳng vào response GET /metrics của nó,
// vì 2 tiến trình không chia sẻ chung 1 prom-client registry global.
export class GetMetricsResponseDto {
  metricsText: string;
}
