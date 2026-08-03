import { ESupervisorVerdict } from '@slack/constants';
export class AvailableAgentDto {
  provider: string;
  label: string;
  description: string;
}

// accuracy_problem.md mục 12 — "mustExecute" do CHÍNH plan() gán tường minh
// (boolean, không phải câu chữ tự nhiên) để lưới an toàn rule-based ở
// TurnResolverService.hasPendingActionStep() nhận diện được bước KHÔNG ĐƯỢC
// BỎ QUA dù user hỏi bằng NGÔN NGỮ BẤT KỲ — trước đó lưới này match theo từ
// khoá tiếng Việt/Anh trong "task" (do LLM tự viết, ngôn ngữ không đảm bảo).
// Từng đổi qua enum 'read'|'write'|'verify' (taxonomy đóng) nhưng vẫn lọt 1
// loại bước thật: TÍNH TOÁN/TỔNG HỢP/PHÂN LOẠI dựa trên dữ liệu đã lấy (không
// phải ghi, không phải so sánh đúng/sai) — model dễ gán nhầm 'read' vì không
// "ghi" đi đâu, khiến lưới an toàn bỏ sót. Dùng boolean hỏi THẲNG đúng câu cần
// biết ("bước này có được phép bỏ qua nếu dữ liệu có vẻ đã đủ không") thay vì
// suy luận qua 1 danh sách loại hành động luôn có nguy cơ thiếu sót.
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
  steps?: DelegationDto[];
  // accuracy_problem.md mục 1 — populated CHỈ khi action='plan' VÀ agent được
  // chọn cho steps[0] khớp 1 cụm mơ hồ (findAmbiguousAgentCluster, Jaccard
  // similarity) — TurnResolverService đọc field này để quyết định hỏi lại user
  // (clarification, nếu ENABLE_CLARIFICATION_HITL=true) thay vì thực thi mù.
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
