import { McpToolDto, McpResourceDto, McpPromptDto } from './mcp.dto';

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
  refreshToken?: string;
  tokenExpiresAt?: Date;
  authConfig?: Record<string, unknown>;
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
