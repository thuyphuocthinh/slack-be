import axios from 'axios';
import { RpcException } from '@nestjs/microservices';
import { McpAuthClientService } from './mcp-auth-client.service';

jest.mock('axios');

describe('McpAuthClientService', () => {
  let service: McpAuthClientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new McpAuthClientService();
  });

  describe('getConnectionStatus', () => {
    it('returns the status list on a well-formed response', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: { data: [{ provider_id: 'jira', is_connected: true }] },
      });

      const result = await service.getConnectionStatus('user-1');

      expect(result).toEqual([{ provider_id: 'jira', is_connected: true }]);
    });

    it('normalizes a 200 response missing the "data" field into RpcException', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ data: {} });

      await expect(
        service.getConnectionStatus('user-1'),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('normalizes a 200 response whose "data" is not an array into RpcException', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: { data: { oops: true } },
      });

      await expect(
        service.getConnectionStatus('user-1'),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('isConnected', () => {
    it('rejects with RpcException instead of leaking a raw TypeError when the response is malformed', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ data: {} });

      await expect(
        service.isConnected('user-1', 'jira'),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('initiateConnect', () => {
    it('normalizes a 200 response missing the "data" field into RpcException', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ data: {} });

      await expect(
        service.initiateConnect({ ownerId: 'user-1', provider: 'jira' } as any),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });
});
