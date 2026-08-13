import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalSkillRecorderService } from './approval-skill-recorder.service';
import { SkillService } from '../memory/skill.service';
import { SkillRetrievalService } from '../memory/skill-retrieval.service';

describe('ApprovalSkillRecorderService', () => {
  let service: ApprovalSkillRecorderService;

  const mockSkillService = {
    create: jest.fn(),
    incrementApprovedRunCount: jest.fn(),
  };
  const mockSkillRetrieval = { findSimilarForAcquisition: jest.fn() };

  const input = {
    checkpointId: 'checkpoint-1',
    workspaceId: 'workspace-1',
    pendingTask: 'cập nhật status đơn OrderId=1',
    pendingTool: {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
    },
    riskLevel: null,
  };

  beforeEach(async () => {
    mockSkillService.create.mockResolvedValue(undefined);
    mockSkillService.incrementApprovedRunCount.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalSkillRecorderService,
        { provide: SkillService, useValue: mockSkillService },
        { provide: SkillRetrievalService, useValue: mockSkillRetrieval },
      ],
    }).compile();

    service = module.get<ApprovalSkillRecorderService>(
      ApprovalSkillRecorderService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('increments the run count of an existing similar skill instead of creating a duplicate', async () => {
    mockSkillRetrieval.findSimilarForAcquisition.mockResolvedValue({
      id: 'skill-1',
    });

    await service.record(input);

    expect(mockSkillService.incrementApprovedRunCount).toHaveBeenCalledWith(
      'skill-1',
      'checkpoint-1',
    );
    expect(mockSkillService.create).not.toHaveBeenCalled();
  });

  it('creates a new skill from the approved tool call when nothing similar exists yet', async () => {
    mockSkillRetrieval.findSimilarForAcquisition.mockResolvedValue(null);

    await service.record(input);

    expect(mockSkillService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        taskDescription: 'cập nhật status đơn OrderId=1',
        sourceCheckpointId: 'checkpoint-1',
        riskLevel: null,
        steps: [
          {
            provider: 'sql_server',
            tool: 'execute_write_query',
            argsTemplate: input.pendingTool.args,
          },
        ],
      }),
    );
  });

  it('swallows errors instead of failing the caller — a bookkeeping failure must not block the approval flow', async () => {
    mockSkillRetrieval.findSimilarForAcquisition.mockRejectedValue(
      new Error('embedding service unavailable'),
    );

    await expect(service.record(input)).resolves.toBeUndefined();
  });
});
