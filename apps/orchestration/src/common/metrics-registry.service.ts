import { Injectable } from '@nestjs/common';
import { Gauge, Registry } from 'prom-client';

// Giai đoạn 4 (Backpressure/Admission control), mục 3/4 — orchestration là
// service TCP thuần, không có HTTP surface riêng để tự phục vụ `/metrics`
// (khác api-gateway, xem `api-gateway.controller.ts`). Giữ 1 Registry RIÊNG ở
// đây (KHÔNG dùng `register` mặc định của prom-client) rồi trả text qua TCP
// (`ORCHESTRATION_MESSAGE_PATTERNS.GET_METRICS`) — api-gateway ghép thẳng vào
// response `/metrics` của chính nó (xem `ApiGatewayController.getMetrics()`).
@Injectable()
export class MetricsRegistryService {
  private readonly registry = new Registry();

  private readonly breakerStateGauge = new Gauge({
    name: 'orchestration_circuit_breaker_state',
    help: 'Trạng thái circuit breaker theo key (0=closed, 1=halfOpen, 2=open)',
    labelNames: ['key'],
    registers: [this.registry],
  });

  private readonly queueDepthGauge = new Gauge({
    name: 'orchestration_queue_depth',
    help: 'Số job AI_ORCHESTRATION_QUEUE theo trạng thái (waiting/active)',
    labelNames: ['state'],
    registers: [this.registry],
  });

  setBreakerState(key: string, state: 'open' | 'halfOpen' | 'closed'): void {
    const value = state === 'open' ? 2 : state === 'halfOpen' ? 1 : 0;
    this.breakerStateGauge.set({ key }, value);
  }

  setQueueDepth(counts: Record<string, number>): void {
    Object.entries(counts).forEach(([state, count]) => {
      this.queueDepthGauge.set({ state }, count);
    });
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }
}
