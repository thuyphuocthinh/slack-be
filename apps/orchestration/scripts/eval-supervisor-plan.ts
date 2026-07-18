/**
 * Giai đoạn Accuracy v2 (`accuracy.v2.md`, mục 1) — golden dataset + eval rẻ,
 * deterministic (Tool Correctness: đúng agent, đúng thứ tự — KHÔNG cần
 * LLM-judge) cho `SupervisorService.plan()`. Gọi THẲNG (không qua HTTP/queue,
 * không cần Docker/DB/Redis — `plan()` chỉ cần LlmStrategyFactory +
 * CircuitBreakerService) với input dựng tay từ `eval-supervisor-plan.dataset.ts`.
 *
 * Chạy:
 *   pnpm eval:supervisor-plan
 * (hoặc thẳng: node -r ts-node/register -r tsconfig-paths/register apps/orchestration/scripts/eval-supervisor-plan.ts)
 *
 * Cần đúng API key thật trong .env ở root (OPENAI_API_KEY mặc định, vì
 * SUPERVISOR_MODEL mặc định = 'gpt-4o-mini') để gọi LLM thật — script KHÔNG
 * mock gì, đúng tinh thần "đo hành vi thật", không phải unit test.
 *
 * Chạy lại MỖI KHI đổi SUPERVISOR_PLANNING_PROMPT / SUPERVISOR_MODEL / bất kỳ
 * cơ chế nào ảnh hưởng plan() (VD agent-level Tool RAG, model tiering — xem
 * accuracy.v2.md) — so % match trước/sau, KHÔNG merge nếu giảm.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

import { SupervisorService } from '../src/llm/supervisor.service';
import { LlmStrategyFactory } from '../src/llm/strategy/llm-strategy.factory';
import { GeminiStrategy } from '../src/llm/strategy/gemini.strategy';
import { OpenAiStrategy } from '../src/llm/strategy/openai.strategy';
import { AnthropicStrategy } from '../src/llm/strategy/anthropic.strategy';
import { MockStrategy } from '../src/llm/strategy/mock.strategy';
import { CircuitBreakerService } from '../src/common/circuit-breaker.service';
import { MetricsRegistryService } from '../src/common/metrics-registry.service';
import { OpenAiEmbeddingProvider } from '../src/registry/openai-embedding.provider';
import { SupervisorPlanDto } from '../src/dto/supervisor.dto';
import {
  SUPERVISOR_PLAN_EVAL_CASES,
  SupervisorPlanEvalCase,
} from './eval-supervisor-plan.dataset';

function buildSupervisor(): SupervisorService {
  const llmFactory = new LlmStrategyFactory(
    new GeminiStrategy(),
    new OpenAiStrategy(),
    new AnthropicStrategy(),
    new MockStrategy(),
  );
  const circuitBreaker = new CircuitBreakerService(new MetricsRegistryService());

  // plan() không đụng tới mcpAuthClient/dynamicProviderDb (2 cái đó chỉ phục
  // vụ getAvailableAgents(), KHÔNG dùng ở đây — dataset tự cấp sẵn `agents`) —
  // stub rỗng, không cần DB/HTTP client thật cho eval script này. embeddingProvider
  // THẬT (mục 2, agent-level Tool RAG) — chỉ thật sự gọi API khi 1 case có
  // agents.length > MAX_AGENTS_BEFORE_RANKING.
  return new SupervisorService(
    {} as any,
    llmFactory,
    circuitBreaker,
    {} as any,
    new OpenAiEmbeddingProvider(),
  );
}

function matches(
  plan: SupervisorPlanDto,
  testCase: SupervisorPlanEvalCase,
): { ok: boolean; reason?: string } {
  if (plan.action !== testCase.expectedAction) {
    return {
      ok: false,
      reason: `action mong đợi "${testCase.expectedAction}", nhận "${plan.action}"`,
    };
  }
  if (testCase.expectedAction === 'respond') {
    return { ok: true };
  }

  const gotAgents = (plan.steps ?? []).map((s) => s.agent);
  const wantAgents = testCase.expectedAgents ?? [];
  const ok = JSON.stringify(gotAgents) === JSON.stringify(wantAgents);
  return ok
    ? { ok: true }
    : {
        ok: false,
        reason: `steps.agent mong đợi ${JSON.stringify(wantAgents)}, nhận ${JSON.stringify(gotAgents)}`,
      };
}

async function main(): Promise<void> {
  const supervisor = buildSupervisor();
  let passed = 0;
  const failures: string[] = [];

  for (const testCase of SUPERVISOR_PLAN_EVAL_CASES) {
    const plan = await supervisor.plan(
      testCase.prompt,
      testCase.agents,
      testCase.rounds ?? [],
      testCase.history ?? [],
    );
    const { ok, reason } = matches(plan, testCase);

    if (ok) {
      passed++;
      console.log(`✅ ${testCase.name}`);
    } else {
      failures.push(`❌ ${testCase.name} — ${reason}\n   raw plan(): ${JSON.stringify(plan)}`);
      console.log(`❌ ${testCase.name} — ${reason}`);
    }
  }

  const total = SUPERVISOR_PLAN_EVAL_CASES.length;
  const percent = Math.round((passed / total) * 100);
  console.log(`\n${passed}/${total} passed (${percent}%)`);

  if (failures.length > 0) {
    console.log('\n--- CHI TIẾT CASE FAIL ---');
    console.log(failures.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('eval-supervisor-plan.ts crashed:', error);
  process.exitCode = 1;
});
