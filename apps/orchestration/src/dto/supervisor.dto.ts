import { ESupervisorVerdict } from '@slack/constants';
export class AvailableAgentDto {
  provider: string;
  label: string;
  description: string;
}

export class DelegationDto {
  agent: string;
  task: string;
  mustExecute?: boolean;
}

// Plan-and-Execute (xem accuracy.md) — thay cho SupervisorDecisionDto cũ.
// "steps" là TOÀN BỘ các bước CÒN LẠI, đúng thứ tự — không chỉ 1 round/lần.
export class SupervisorPlanDto {
  action: 'respond' | 'plan';
  answer?: string;
  rememberFact?: string;
  steps?: DelegationDto[];
  ambiguousCandidates?: AvailableAgentDto[];
}

export type SupervisorEvaluateVerdict = ESupervisorVerdict;

// Trả về SAU MỖI bước trong kế hoạch — quyết định có bám theo kế hoạch cũ
// (continue), lập lại kế hoạch (re-plan), hay dừng vì đã đủ dữ liệu (done).
export class SupervisorEvaluateDto {
  verdict: SupervisorEvaluateVerdict;
  reason?: string;
}

/** 1 vòng delegate đã chạy xong trong turn hiện tại — đưa lại cho Supervisor
 * ở vòng quyết định tiếp theo để nó biết đã làm gì, kết quả ra sao. */
export class SupervisorRoundDto {
  agent: string;
  task: string;
  result: string;
}
