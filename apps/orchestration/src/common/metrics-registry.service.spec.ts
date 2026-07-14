import { Test, TestingModule } from '@nestjs/testing';
import { MetricsRegistryService } from './metrics-registry.service';

describe('MetricsRegistryService (Backpressure/Admission control, mục 3/4)', () => {
  let service: MetricsRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsRegistryService],
    }).compile();

    service = module.get<MetricsRegistryService>(MetricsRegistryService);
  });

  it('exposes the breaker state gauge in Prometheus text format, encoded as 0/1/2', async () => {
    service.setBreakerState('mcp:sql_server', 'closed');
    service.setBreakerState('llm:gemini', 'open');

    const text = await service.getMetricsText();

    expect(text).toContain(
      'orchestration_circuit_breaker_state{key="mcp:sql_server"} 0',
    );
    expect(text).toContain(
      'orchestration_circuit_breaker_state{key="llm:gemini"} 2',
    );
  });

  it('encodes "halfOpen" as 1', async () => {
    service.setBreakerState('mcp:recovering', 'halfOpen');

    const text = await service.getMetricsText();

    expect(text).toContain(
      'orchestration_circuit_breaker_state{key="mcp:recovering"} 1',
    );
  });

  it('exposes the queue depth gauge, one series per state', async () => {
    service.setQueueDepth({ waiting: 12, active: 5 });

    const text = await service.getMetricsText();

    expect(text).toContain('orchestration_queue_depth{state="waiting"} 12');
    expect(text).toContain('orchestration_queue_depth{state="active"} 5');
  });
});
