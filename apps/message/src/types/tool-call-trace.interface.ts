export interface IToolCallTrace {
  tool: string;
  // 'awaiting_approval' — Giai đoạn 3 (HITL) orchestration, tool bị chặn đang
  // chờ user duyệt.
  status: 'success' | 'error' | 'awaiting_approval';
  resultPreview?: string;
}
