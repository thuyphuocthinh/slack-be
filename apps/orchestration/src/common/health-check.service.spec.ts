import { Test, TestingModule } from '@nestjs/testing';
import { CachedService } from '@slack/cached';
import { DatabaseHealthService } from '@slack/database';
import { QueueService, EQueueName } from '@slack/queue';
import { HealthCheckService } from './health-check.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MetricsRegistryService } from './metrics-registry.service';

describe('HealthCheckService (Backpressure/Admission control, mục 2/3)', () => {
  let service: HealthCheckService;

  const mockCached = { ping: jest.fn() };
  const mockDatabaseHealth = { isAlive: jest.fn() };
  const mockCircuitBreaker = { getStates: jest.fn() };
  const mockQueueService = { getJobCounts: jest.fn() };
  const mockMetrics = { setQueueDepth: jest.fn(), getMetricsText: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCheckService,
        { provide: CachedService, useValue: mockCached },
        { provide: DatabaseHealthService, useValue: mockDatabaseHealth },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: QueueService, useValue: mockQueueService },
        { provide: MetricsRegistryService, useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<HealthCheckService>(HealthCheckService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('check', () => {
    it('reports "ok" when redis and database are both alive', async () => {
      mockCached.ping.mockResolvedValue(true);
      mockDatabaseHealth.isAlive.mockResolvedValue(true);
      mockCircuitBreaker.getStates.mockReturnValue({ 'mcp:sql_server': 'closed' });
      mockQueueService.getJobCounts.mockResolvedValue({ waiting: 2, active: 1 });

      const result = await service.check();

      expect(result).toEqual({
        status: 'ok',
        redis: true,
        database: true,
        circuitBreakers: { 'mcp:sql_server': 'closed' },
        queueDepth: { waiting: 2, active: 1 },
      });
      expect(mockQueueService.getJobCounts).toHaveBeenCalledWith(
        EQueueName.AI_ORCHESTRATION_QUEUE,
      );
    });

    it('reports "degraded" when redis is down, even if the database is fine', async () => {
      mockCached.ping.mockResolvedValue(false);
      mockDatabaseHealth.isAlive.mockResolvedValue(true);
      mockCircuitBreaker.getStates.mockReturnValue({});
      mockQueueService.getJobCounts.mockResolvedValue({ waiting: 0, active: 0 });

      const result = await service.check();

      expect(result.status).toBe('degraded');
    });

    it('reports "degraded" when the database is down, even if redis is fine', async () => {
      mockCached.ping.mockResolvedValue(true);
      mockDatabaseHealth.isAlive.mockResolvedValue(false);
      mockCircuitBreaker.getStates.mockReturnValue({});
      mockQueueService.getJobCounts.mockResolvedValue({ waiting: 0, active: 0 });

      const result = await service.check();

      expect(result.status).toBe('degraded');
    });

    it('refreshes the queue depth gauge with the counts it just fetched', async () => {
      mockCached.ping.mockResolvedValue(true);
      mockDatabaseHealth.isAlive.mockResolvedValue(true);
      mockCircuitBreaker.getStates.mockReturnValue({});
      mockQueueService.getJobCounts.mockResolvedValue({ waiting: 5, active: 3 });

      await service.check();

      expect(mockMetrics.setQueueDepth).toHaveBeenCalledWith({
        waiting: 5,
        active: 3,
      });
    });
  });

  describe('getMetricsText', () => {
    it('delegates to MetricsRegistryService.getMetricsText', async () => {
      mockMetrics.getMetricsText.mockResolvedValue('# metrics');

      await expect(service.getMetricsText()).resolves.toBe('# metrics');
    });
  });
});
