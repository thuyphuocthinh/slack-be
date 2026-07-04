import { Test, TestingModule } from '@nestjs/testing';
import { CheckpointCleanupService } from './checkpoint-cleanup.service';
import { CheckpointService } from './checkpoint.service';
import { MessageClientService } from '../message-client.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { OrchestrationCheckpointStatus } from '../entity/orchestration-checkpoint.entity';

describe('CheckpointCleanupService', () => {
  let service: CheckpointCleanupService;

  const mockCheckpoint = { findExpiredPending: jest.fn(), claim: jest.fn() };
  const mockMessageClient = { updateMessage: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };

  const expiredCheckpoint = {
    id: 'checkpoint-1',
    replyMessageId: 'approval-msg-1',
    userId: 'user-1',
    channelId: 'channel-1',
    channelType: 'direct',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckpointCleanupService,
        { provide: CheckpointService, useValue: mockCheckpoint },
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: AgentStreamService, useValue: mockAgentStream },
      ],
    }).compile();

    service = module.get<CheckpointCleanupService>(CheckpointCleanupService);
  });

  it('does nothing when there is nothing expired', async () => {
    mockCheckpoint.findExpiredPending.mockResolvedValue([]);

    await service.expirePendingCheckpoints();

    expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
  });

  it('claims each expired checkpoint as rejected, edits its message, and emits done', async () => {
    mockCheckpoint.findExpiredPending.mockResolvedValue([expiredCheckpoint]);
    mockCheckpoint.claim.mockResolvedValue({ claimed: true });

    await service.expirePendingCheckpoints();

    expect(mockCheckpoint.claim).toHaveBeenCalledWith({
      id: 'checkpoint-1',
      toStatus: OrchestrationCheckpointStatus.REJECTED,
    });
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'approval-msg-1',
      userId: 'user-1',
      content: '⏱️ Yêu cầu duyệt đã hết hạn, tự động huỷ.',
    });
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        channelId: 'channel-1',
        messageId: 'approval-msg-1',
        channelType: 'direct',
      },
      { type: 'done' },
    );
  });

  it('skips a checkpoint the user just resolved themselves (lost the claim race) without touching its message', async () => {
    mockCheckpoint.findExpiredPending.mockResolvedValue([expiredCheckpoint]);
    mockCheckpoint.claim.mockResolvedValue({ claimed: false });

    await service.expirePendingCheckpoints();

    expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    expect(mockAgentStream.emitStep).not.toHaveBeenCalled();
  });

  it('processes multiple expired checkpoints independently', async () => {
    const second = {
      ...expiredCheckpoint,
      id: 'checkpoint-2',
      replyMessageId: 'approval-msg-2',
      userId: 'user-2',
    };
    mockCheckpoint.findExpiredPending.mockResolvedValue([
      expiredCheckpoint,
      second,
    ]);
    mockCheckpoint.claim.mockResolvedValue({ claimed: true });

    await service.expirePendingCheckpoints();

    expect(mockMessageClient.updateMessage).toHaveBeenCalledTimes(2);
  });
});
