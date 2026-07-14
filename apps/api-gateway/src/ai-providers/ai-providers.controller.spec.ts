import { Test, TestingModule } from '@nestjs/testing';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';

describe('AiProvidersController.getHealth (Backpressure/Admission control, mục 2)', () => {
  let controller: AiProvidersController;
  const mockAiProvidersService = { getHealth: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiProvidersController],
      providers: [
        { provide: AiProvidersService, useValue: mockAiProvidersService },
      ],
    }).compile();

    controller = module.get<AiProvidersController>(AiProvidersController);
  });

  afterEach(() => jest.clearAllMocks());

  it('delegates to AiProvidersService.getHealth with no user context (public monitoring route)', async () => {
    const health = {
      status: 'ok',
      redis: true,
      database: true,
      circuitBreakers: {},
      queueDepth: { waiting: 0, active: 0 },
    };
    mockAiProvidersService.getHealth.mockResolvedValue(health);

    const result = await controller.getHealth();

    expect(mockAiProvidersService.getHealth).toHaveBeenCalledWith();
    expect(result).toEqual(health);
  });
});
