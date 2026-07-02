import { McpToolDto } from './mcp.dto';

export class GetProvidersRequestDto {
  userId: string;
}

export class ProviderSummaryDto {
  provider: string;
  label: string;
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
