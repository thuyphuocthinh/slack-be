// Dùng CHUNG bởi eval-supervisor-plan.ts và eval-supervisor-evaluate.ts —
// tách riêng khỏi 2 file *.ts trên có chủ đích: cả 2 đều tự chạy main() ở
// top-level khi được `node` chạy trực tiếp — nếu buildSupervisor() nằm chung
// file với 1 trong 2, import nó từ file kia sẽ vô tình kéo theo main() của
// file đó chạy luôn như side-effect (đã xảy ra thật khi thử ghép, xem log
// lẫn lộn plan()/evaluate() lúc build eval-supervisor-evaluate.ts). File này
// KHÔNG có main(), chỉ export function — import an toàn từ bất kỳ đâu.
import { SupervisorService } from '../src/llm/supervisor.service';
import { LlmStrategyFactory } from '../src/llm/strategy/llm-strategy.factory';
import { GeminiStrategy } from '../src/llm/strategy/gemini.strategy';
import { OpenAiStrategy } from '../src/llm/strategy/openai.strategy';
import { AnthropicStrategy } from '../src/llm/strategy/anthropic.strategy';
import { MockStrategy } from '../src/llm/strategy/mock.strategy';
import { CircuitBreakerService } from '../src/common/circuit-breaker.service';
import { MetricsRegistryService } from '../src/common/metrics-registry.service';
import { OpenAiEmbeddingProvider } from '../src/registry/openai-embedding.provider';
import { MemoryManagerService } from '../src/memory/memory-manager.service';
import { AgentRankingService } from '../src/llm/agent-ranking.service';
import { SupervisorPromptBuilder } from '../src/llm/supervisor-prompt.builder';

if (process.env.OPENAI_EMBEDDING_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.OPENAI_EMBEDDING_API_KEY;
  process.env.AI_ROUTER_URL = 'https://api.openai.com/v1';

  // LLM_MODEL_REGISTRY lưu model id kiểu "openai/gpt-4o-mini" — tiền tố
  // "openai/" là quy ước riêng của 9Router, OpenAI thật KHÔNG hiểu (trả "400
  // invalid model ID"). Strip tiền tố CHỈ khi gọi thẳng OpenAI (bypass ở
  // trên) — monkeypatch phạm vi module này, không sửa openai.strategy.ts gốc
  // (production vẫn cần giữ nguyên tiền tố khi đi qua 9Router thật).
  const original = OpenAiStrategy.prototype.generateStructured;
  OpenAiStrategy.prototype.generateStructured = function (opts: any) {
    return original.call(this, {
      ...opts,
      model: opts.model.replace(/^openai\//, ''),
    });
  };
}

// CircuitBreakerService lưu state ở Redis thật (xem circuit-breaker.service.ts)
// — script eval chỉ cần nó luôn "closed" (không chặn LLM call thật), không
// cần đo hành vi mở/đóng mạch, nên fake tối thiểu 4 lệnh nó gọi tới thay vì
// kéo theo Redis thật.
function buildNoOpRedisStub(): any {
  return {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    eval: async () => 'closed',
  };
}

// plan()/evaluate() không đụng tới mcpAuthClient/dynamicProviderDb/
// skillRetrieval/edgeRelayRegistry (chỉ phục vụ getAvailableAgents(), KHÔNG
// gọi ở đây — dataset của cả 2 eval script tự cấp sẵn `agents`, và không case
// nào truyền workspaceId/channelId ngoài rounds) — stub rỗng, không cần DB/
// HTTP thật. agentRanking DÙNG THẬT (chỉ thật sự gọi API khi 1 case có
// agents.length > MAX_AGENTS_BEFORE_RANKING). memoryManager/promptBuilder
// DÙNG THẬT (chỉ tính toán thuần, không cần DB) vì buildPrompt() gọi
// buildBudget() bất cứ khi nào 1 case có `rounds` sẵn, và evaluate() cũng gọi
// buildBudget() để cap kết quả tool.
export function buildSupervisor(): SupervisorService {
  const llmFactory = new LlmStrategyFactory(
    new GeminiStrategy(),
    new OpenAiStrategy(),
    new AnthropicStrategy(),
    new MockStrategy(),
  );
  const metrics = new MetricsRegistryService();
  const circuitBreaker = new CircuitBreakerService(
    buildNoOpRedisStub(),
    metrics,
  );
  const memoryManager = new MemoryManagerService({} as any);

  return new SupervisorService(
    {} as any,
    llmFactory,
    circuitBreaker,
    {} as any,
    metrics,
    memoryManager,
    {} as any,
    new AgentRankingService(new OpenAiEmbeddingProvider()),
    new SupervisorPromptBuilder(memoryManager),
    {} as any,
  );
}
