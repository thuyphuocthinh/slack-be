/**
 * Giai đoạn Accuracy v2 — golden dataset + eval rẻ, deterministic (so đúng
 * "verdict", KHÔNG cần LLM-judge vì output chỉ có 3 giá trị) cho
 * `SupervisorService.evaluate()` — bước quyết định CONTINUE/RE-PLAN/DONE sau
 * MỖI bước trong kế hoạch. Cùng cơ chế đo với `eval-supervisor-plan.ts`
 * (REPEATS=3 để dò self-consistency), gọi THẲNG evaluate() (không qua HTTP/
 * queue/DB/Redis).
 *
 * Chạy:
 *   pnpm eval:supervisor-evaluate
 *
 * Cần đúng API key thật trong .env ở root (OPENAI_API_KEY mặc định, vì
 * SUPERVISOR_MODEL mặc định = 'gpt-4o-mini') — script KHÔNG mock gì.
 *
 * Chạy lại MỖI KHI đổi SUPERVISOR_EVALUATE_PROMPT/SUPERVISOR_EVALUATE_SCHEMA(_NO_DONE)
 * hoặc pending-action-step.util.ts — so % match trước/sau, KHÔNG merge nếu giảm.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

import { SupervisorEvaluateDto } from '../src/dto/supervisor.dto';
import { buildSupervisor } from './eval-supervisor.shared';
import {
  SUPERVISOR_EVALUATE_EVAL_CASES,
  SupervisorEvaluateEvalCase,
} from './eval-supervisor-evaluate.dataset';

const REPEATS = 3;

function matches(
  verdict: SupervisorEvaluateDto,
  testCase: SupervisorEvaluateEvalCase,
): { ok: boolean; reason?: string } {
  const got = verdict.verdict as unknown as string;
  return got === testCase.expectedVerdict
    ? { ok: true }
    : {
        ok: false,
        reason: `verdict mong đợi "${testCase.expectedVerdict}", nhận "${got}"`,
      };
}

async function runRepeats(
  testCase: SupervisorEvaluateEvalCase,
): Promise<SupervisorEvaluateDto[]> {
  const results: SupervisorEvaluateDto[] = [];
  for (let i = 0; i < REPEATS; i++) {
    // buildSupervisor() rẻ (không I/O), dựng mới mỗi lần chạy để không rò rỉ
    // state giữa các repeat — evaluate() tự thân không giữ state, nhưng giữ
    // đồng nhất với cách eval-supervisor-plan.ts gọi lại supervisor.plan()
    // nhiều lần trên CÙNG 1 instance thì cũng không sao; ở đây tách riêng
    // cho rõ ràng vì mỗi case độc lập hoàn toàn.
    const supervisor = buildSupervisor();
    results.push(
      await supervisor.evaluate(
        testCase.originalPrompt,
        testCase.completedStep,
        testCase.remainingSteps,
      ),
    );
  }
  return results;
}

async function main(): Promise<void> {
  const gradedCases = SUPERVISOR_EVALUATE_EVAL_CASES.filter(
    (c) => !c.diagnostic,
  );
  const diagnosticCases = SUPERVISOR_EVALUATE_EVAL_CASES.filter(
    (c) => c.diagnostic,
  );

  let fullyConsistentPass = 0;
  let fullyConsistentFail = 0;
  const inconsistentCases: string[] = [];
  const failureDetails: string[] = [];

  for (const testCase of gradedCases) {
    const runs = await runRepeats(testCase);
    const verdicts = runs.map((v) => matches(v, testCase));
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
        `⚠️  ${testCase.name} (${passCount}/${REPEATS}) — KHÔNG ỔN ĐỊNH giữa các lần chạy CÙNG 1 input`,
      );
      runs.forEach((v, i) => {
        console.log(
          `     lần ${i + 1}: ${(v.verdict as unknown as string)} — ${verdicts[i].ok ? 'đúng' : 'sai'}`,
        );
      });
    }
  }

  console.log('\n--- Case diagnostic (mơ hồ thật, không chấm đúng/sai) ---');
  for (const testCase of diagnosticCases) {
    const runs = await runRepeats(testCase);
    const signatures = runs.map((v) => v.verdict as unknown as string);
    const distinct = Array.from(new Set(signatures));
    const stable = distinct.length === 1;
    console.log(
      `${stable ? '➖' : '⚠️ '} ${testCase.name}: ${signatures.join(' | ')}${
        stable
          ? ' (ổn định — luôn chọn giống nhau, nhưng KHÔNG có nghĩa là đúng)'
          : ' (ĐỔI QUA LẠI giữa các lựa chọn — tín hiệu cho thấy evaluate() cũng không chắc ở case này)'
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
  console.error('eval-supervisor-evaluate.ts crashed:', error);
  process.exitCode = 1;
});
