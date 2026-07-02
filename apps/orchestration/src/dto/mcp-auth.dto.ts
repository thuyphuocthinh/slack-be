export class ProviderStatusDto {
  provider_id: string;
  is_connected: boolean;
  status: string;
  connected_at: string | null;
}

export class ProviderFieldDto {
  name: string;
  type: string;
  label: string;
  default?: string | number;
}

export class InitiateConnectRequestDto {
  ownerId: string;
  provider: string;
}

export class InitiateConnectResponseDto {
  type: 'oauth' | 'form' | 'api_key';
  auth_url?: string;
  fields?: ProviderFieldDto[];
}

export class SubmitCredentialsRequestDto {
  ownerId: string;
  provider: string;
  credentials: Record<string, string>;
}
