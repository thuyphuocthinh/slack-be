import { Test, TestingModule } from '@nestjs/testing';
import { ESocketEvent } from '@slack/constants';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { AgentStreamService, DEFAULT_STREAM_KEY } from './agent-stream.service';

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
        data: {
          type: 'tool_call',
          tool: 'get_schema',
          channelId: 'channel-1',
          messageId: 'msg-1',
          streamKey: DEFAULT_STREAM_KEY,
        },
      }),
    );
  });

  it('defaults streamKey to DEFAULT_STREAM_KEY when the context does not specify one', async () => {
    await service.emitStep(
      { userId: 'user-1', channelId: 'channel-1', messageId: 'msg-1', channelType: 'direct' },
      { type: 'token', text: 'hi' },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({ data: expect.objectContaining({ streamKey: DEFAULT_STREAM_KEY }) }),
    );
  });

  it('passes through a caller-supplied streamKey untouched (Supervisor fan-out — multiple ReactLoop runs on the same messageId)', async () => {
    await service.emitStep(
      { userId: 'user-1', channelId: 'channel-1', messageId: 'msg-1', channelType: 'direct', streamKey: 'r0-sql_server' },
      { type: 'token', text: 'hi' },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({ data: expect.objectContaining({ streamKey: 'r0-sql_server' }) }),
    );
  });

  it('emits only to the personal room for a GROUP channel too — no channel/group broadcast', async () => {
    await service.emitStep(
      { userId: 'user-1', channelId: 'channel-1', messageId: 'msg-1', channelType: 'group' },
      { type: 'tool_result', tool: 'get_schema', status: 'success', resultPreview: 'ok' },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledTimes(1);
    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({ room: 'user_user-1' }),
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
