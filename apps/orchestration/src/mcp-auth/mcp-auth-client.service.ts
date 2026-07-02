import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import axios from 'axios';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import {
  InitiateConnectRequestDto,
  InitiateConnectResponseDto,
  ProviderStatusDto,
  SubmitCredentialsRequestDto,
} from '../dto/mcp-auth.dto';

@Injectable()
export class McpAuthClientService {
  private readonly logger = new Logger(McpAuthClientService.name);
  private readonly baseUrl = process.env.MCP_AUTH_BASE_URL;
  private readonly basicAuthHeader: string | undefined;

  constructor() {
    const clientId = process.env.MCP_AUTH_CLIENT_ID;
    const clientSecret = process.env.MCP_AUTH_CLIENT_SECRET;
    this.basicAuthHeader =
      clientId && clientSecret
        ? `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        : undefined;
  }

  async getConnectionStatus(ownerId: string): Promise<ProviderStatusDto[]> {
    try {
      const res = await axios.get(`${this.baseUrl}/connect/status`, {
        params: { owner_id: ownerId },
        headers: { Authorization: this.basicAuthHeader },
      });
      return res.data.data;
    } catch (error) {
      this.logger.error(`getConnectionStatus failed: ${error.message}`);
      throw new RpcException(ORCHESTRATION_ERROR.MCP_AUTH_REQUEST_FAILED);
    }
  }

  async isConnected(ownerId: string, provider: string): Promise<boolean> {
    const statuses = await this.getConnectionStatus(ownerId);
    return statuses.some((s) => s.provider_id === provider && s.is_connected);
  }

  async initiateConnect(dto: InitiateConnectRequestDto): Promise<InitiateConnectResponseDto> {
    try {
      const res = await axios.get(`${this.baseUrl}/connect/initiate`, {
        params: { owner_id: dto.ownerId, provider: dto.provider },
        headers: { Authorization: this.basicAuthHeader },
      });
      return res.data.data;
    } catch (error) {
      this.logger.error(`initiateConnect failed: ${error.message}`);
      throw new RpcException(ORCHESTRATION_ERROR.MCP_AUTH_REQUEST_FAILED);
    }
  }

  async submitCredentials(dto: SubmitCredentialsRequestDto): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/connect/submit`,
        { owner_id: dto.ownerId, provider: dto.provider, credentials: dto.credentials },
        { headers: { Authorization: this.basicAuthHeader } },
      );
    } catch (error) {
      this.logger.error(`submitCredentials failed: ${error.message}`);
      throw new RpcException(ORCHESTRATION_ERROR.MCP_AUTH_REQUEST_FAILED);
    }
  }
}
