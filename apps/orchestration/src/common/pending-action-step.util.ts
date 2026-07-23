import { DelegationDto } from '../dto/supervisor.dto';

// accuracy_problem.md mục 6/11/12/13/14 — dùng CHUNG bởi 2 nơi, PHẢI đồng bộ
// 1 nguồn sự thật DUY NHẤT (tách ra file riêng thay vì để private trong 1
// service, tránh 2 bản định nghĩa lệch nhau về sau):
// - TurnResolverService.runEvaluateAndDecide() — lưới an toàn RULE-BASED bác
//   bỏ "done" của evaluate() SAU KHI đã gọi (defense-in-depth, phòng model/
//   provider không tuân schema tuyệt đối).
// - SupervisorService.evaluate() (mục 14) — chặn HẲN "done" khỏi schema TRƯỚC
//   KHI gọi LLM, khi đã biết chắc còn bước bắt buộc — mạnh hơn override vì
//   loại trừ khả năng thay vì chỉ giảm xác suất.
//
// Ưu tiên field "mustExecute" (boolean do CHÍNH plan() gán tường minh) — nhận
// diện ĐÚNG dù user hỏi bằng ngôn ngữ bất kỳ, không bị giới hạn bởi 1 danh
// sách loại hành động cố định (đã từng dùng enum 'read'|'write'|'verify'
// nhưng lọt bước TÍNH TOÁN/TỔNG HỢP dựa trên dữ liệu đã lấy). OR thêm 3 danh
// sách từ khoá (tiếng Việt/Anh) làm lớp phòng thủ MIỄN PHÍ, LUÔN chạy kể cả
// khi model đã điền mustExecute — phòng trường hợp model điền SAI.
const ACTION_TASK_KEYWORDS = [
  'ghi',
  'chèn',
  'thêm',
  'tạo',
  'sửa',
  'cập nhật',
  'xoá',
  'xóa',
  'lưu',
  'insert',
  'update',
  'delete',
  'create',
  'write',
  'save',
  'append',
  'remove',
];

const VERIFICATION_TASK_KEYWORDS = [
  'kiểm tra',
  'so sánh',
  'xác định',
  'đối chiếu',
  'khớp',
  'tồn tại',
  'xác nhận',
  'check',
  'compare',
  'verify',
];

const COMPUTE_TASK_KEYWORDS = [
  'tính',
  'tổng hợp',
  'tổng',
  'phân loại',
  'phân tích',
  'thống kê',
  'trung bình',
  'gộp',
  'calculate',
  'compute',
  'aggregate',
  'summarize',
  'analyze',
  'classify',
];

export function hasPendingActionStep(steps: DelegationDto[]): boolean {
  return steps.some((s) => {
    if (s.mustExecute === true) return true;
    const taskLower = s.task.toLowerCase();
    return (
      ACTION_TASK_KEYWORDS.some((kw) => taskLower.includes(kw)) ||
      VERIFICATION_TASK_KEYWORDS.some((kw) => taskLower.includes(kw)) ||
      COMPUTE_TASK_KEYWORDS.some((kw) => taskLower.includes(kw))
    );
  });
}
