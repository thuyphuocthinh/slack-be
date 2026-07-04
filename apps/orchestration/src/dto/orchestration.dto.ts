import { McpToolDto } from './mcp.dto';

export class GetProvidersRequestDto {
  userId: string;
}

export class ProviderSummaryDto {
  provider: string;
  label: string;
  description: string;
  isConnected: boolean;
  tools: McpToolDto[];
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
