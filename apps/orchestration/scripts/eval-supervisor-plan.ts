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
 *
 * Giai đoạn Accuracy v2, mục 5/6 — mỗi case (kể cả case chấm điểm bình
 * thường) được chạy lại REPEATS lần để dò 2 tín hiệu:
 * - Case chấm điểm mà pass/fail KHÔNG ổn định giữa các lần chạy cùng 1 input
 *   → bằng chứng trực tiếp ủng hộ mục 5 (self-consistency/voting).
 * - Case `diagnostic: true` (prompt mơ hồ, không có 1 đáp án đúng) → quan sát
 *   plan() có chọn ổn định 1 agent hay đổi qua lại giữa các lần chạy, để biết
 *   có đáng làm mục 6 (hỏi lại user khi không chắc) hay không.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

import { SupervisorService } from '../src/llm/supervisor.service';
import { SupervisorPlanDto } from '../src/dto/supervisor.dto';
import { buildSupervisor } from './eval-supervisor.shared';
import {
  SUPERVISOR_PLAN_EVAL_CASES,
  SupervisorPlanEvalCase,
} from './eval-supervisor-plan.dataset';

const REPEATS = 3;

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
  const ok = testCase.ignoreStepCount
    ? gotAgents.length > 0 && gotAgents.every((a) => wantAgents.includes(a))
    : JSON.stringify(gotAgents) === JSON.stringify(wantAgents);
  return ok
    ? { ok: true }
    : {
        ok: false,
        reason: `steps.agent mong đợi ${JSON.stringify(wantAgents)}, nhận ${JSON.stringify(gotAgents)}`,
      };
}

/** Chữ ký ngắn gọn của 1 kết quả plan(), dùng để so sánh các lần chạy lặp lại có RA CÙNG 1 kết quả hay không. */
function signatureOf(plan: SupervisorPlanDto): string {
  if (plan.action === 'respond') return 'respond';
  return `plan:${(plan.steps ?? []).map((s) => s.agent).join('>')}`;
}

async function runRepeats(
  supervisor: SupervisorService,
  testCase: SupervisorPlanEvalCase,
): Promise<SupervisorPlanDto[]> {
  const results: SupervisorPlanDto[] = [];
  for (let i = 0; i < REPEATS; i++) {
    results.push(
      await supervisor.plan(
        testCase.prompt,
        testCase.agents,
        testCase.rounds ?? [],
        testCase.history ?? [],
      ),
    );
  }
  return results;
}

async function main(): Promise<void> {
  const supervisor = buildSupervisor();

  const gradedCases = SUPERVISOR_PLAN_EVAL_CASES.filter((c) => !c.diagnostic);
  const diagnosticCases = SUPERVISOR_PLAN_EVAL_CASES.filter(
    (c) => c.diagnostic,
  );

  let fullyConsistentPass = 0;
  let fullyConsistentFail = 0;
  const inconsistentCases: string[] = [];
  const failureDetails: string[] = [];

  for (const testCase of gradedCases) {
    const runs = await runRepeats(supervisor, testCase);
    const verdicts = runs.map((plan) => matches(plan, testCase));
    const passCount = verdicts.filter((v) => v.ok).length;

    if (passCount === REPEATS) {
      fullyConsistentPass++;
      console.log(`✅ ${testCase.name} (${passCount}/${REPEATS})`);
    } else if (passCount === 0) {
      fullyConsistentFail++;
      console.log(
        `❌ ${testCase.name} (0/${REPEATS}) — sai ổn định, không phải do thiếu self-consistency`,
      );
      failureDetails.push(
        `❌ ${testCase.name} — sai ở cả ${REPEATS} lần chạy. Lần 1: ${verdicts[0].reason}\n   raw: ${JSON.stringify(runs[0])}`,
      );
    } else {
      inconsistentCases.push(testCase.name);
      console.log(
        `⚠️  ${testCase.name} (${passCount}/${REPEATS}) — KHÔNG ỔN ĐỊNH giữa các lần chạy CÙNG 1 input (tín hiệu ủng hộ mục 5 — self-consistency)`,
      );
      runs.forEach((plan, i) => {
        console.log(
          `     lần ${i + 1}: ${signatureOf(plan)} — ${verdicts[i].ok ? 'đúng' : 'sai'}`,
        );
      });
    }
  }

  console.log('\n--- Case diagnostic (prompt mơ hồ, không chấm đúng/sai) ---');
  for (const testCase of diagnosticCases) {
    const runs = await runRepeats(supervisor, testCase);
    const signatures = runs.map(signatureOf);
    const distinct = Array.from(new Set(signatures));
    const stable = distinct.length === 1;
    console.log(
      `${stable ? '➖' : '⚠️ '} ${testCase.name}: ${signatures.join(' | ')}${
        stable
          ? ' (ổn định — luôn chọn giống nhau, nhưng KHÔNG có nghĩa là đúng)'
          : ' (ĐỔI QUA LẠI giữa các lựa chọn — tín hiệu ủng hộ mục 6, nên hỏi lại user thay vì tự đoán)'
      }`,
    );
  }

  const totalGraded = gradedCases.length;
  const percent = Math.round((fullyConsistentPass / totalGraded) * 100);
  console.log(
    `\n${fullyConsistentPass}/${totalGraded} graded cases pass ỔN ĐỊNH cả ${REPEATS} lần (${percent}%)`,
  );
  console.log(
    `${inconsistentCases.length} case KHÔNG ổn định giữa các lần chạy: ${inconsistentCases.join(', ') || '(không có)'}`,
  );

  if (failureDetails.length > 0) {
    console.log('\n--- CHI TIẾT CASE SAI ỔN ĐỊNH ---');
    console.log(failureDetails.join('\n'));
  }

  if (fullyConsistentFail > 0 || inconsistentCases.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('eval-supervisor-plan.ts crashed:', error);
  process.exitCode = 1;
});
