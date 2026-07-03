import { Test, TestingModule } from '@nestjs/testing';
import { ESocketEvent } from '@slack/constants';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { AgentStreamService } from './agent-stream.service';

describe('AgentStreamService', () => {
  let service: AgentStreamService;

  const mockQueueService = { addJob: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgentStreamService, { provide: QueueService, useValue: mockQueueService }],
    }).compile();

    service = module.get<AgentStreamService>(AgentStreamService);
  });

  afterEach(() => jest.clearAllMocks());

  it('emits only to the personal room for a DIRECT channel', async () => {
    await service.emitStep(
      { userId: 'user-1', channelId: 'channel-1', messageId: 'msg-1', channelType: 'direct' },
      { type: 'tool_call', tool: 'get_schema' },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledTimes(1);
    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({
        event: ESocketEvent.AGENT_STREAM,
        room: 'user_user-1',
        data: { type: 'tool_call', tool: 'get_schema', channelId: 'channel-1', messageId: 'msg-1' },
      }),
    );
  });

  it('also emits a coarse signal (no tool detail) to the channel room for a GROUP channel', async () => {
    await service.emitStep(
      { userId: 'user-1', channelId: 'channel-1', messageId: 'msg-1', channelType: 'group' },
      { type: 'tool_result', tool: 'get_schema', status: 'success', resultPreview: 'ok' },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledTimes(2);
    expect(mockQueueService.addJob).toHaveBeenNthCalledWith(
      2,
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({
        room: 'channel-1',
        data: { type: 'tool_result', channelId: 'channel-1', messageId: 'msg-1' }, // không kèm tool/status/resultPreview
      }),
    );
  });

  it('emits a "done" step the same way as any other step type', async () => {
    await service.emitStep({ userId: 'user-1', channelId: 'channel-1', messageId: 'msg-1', channelType: 'direct' }, { type: 'done' });

    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({ room: 'user_user-1', data: expect.objectContaining({ type: 'done' }) }),
    );
  });
});
