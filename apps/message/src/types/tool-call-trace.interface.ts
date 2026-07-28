export interface IToolCallTrace {
  tool: string;
  // 'awaiting_approval' — Giai đoạn 3 (HITL) orchestration, tool bị chặn đang
  // chờ user duyệt.
  status: 'success' | 'error' | 'awaiting_approval';
  resultPreview?: string;
  // Tham số THẬT LLM đã sinh ra để gọi tool (VD code Python của run_python,
  // câu SQL của execute_*_query) — hiển thị cho user xem/copy trên UI, KHÔNG
  // dùng để feed ngược lại LLM (khác resultPreview). Trước đây bị bỏ hoàn
  // toàn (chỉ còn lại trong 1 dòng debug log), user không thấy được code nào
  // đã thực thi.
  argsPreview?: string;
}
