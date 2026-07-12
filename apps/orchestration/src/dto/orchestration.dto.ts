import { McpToolDto, McpResourceDto, McpPromptDto } from './mcp.dto';
import { EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';

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

// Giai đoạn 3 (HITL) — messageId là message "approval_request" FE đang hiện
// nút Approve/Reject trên đó, KHÔNG phải messageId gốc user hỏi ban đầu.
export class ResolveApprovalRequestDto {
  userId: string;
  messageId: string;
  action: 'approve' | 'reject';
}

export class ResolveApprovalResponseDto {
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
  refreshRequestFormat?: 'form' | 'json';
}

export class RegisterDynamicProviderResponseDto {
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
