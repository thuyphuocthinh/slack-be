import { DelegationDto, SupervisorRoundDto } from '../src/dto/supervisor.dto';

export interface SupervisorEvaluateEvalCase {
  name: string;
  originalPrompt: string;
  completedStep: SupervisorRoundDto;
  remainingSteps: DelegationDto[];
  // Giá trị THẬT mà LLM trả về theo đúng JSON schema (SUPERVISOR_EVALUATE_SCHEMA
  // / _NO_DONE ở orchestration.constant.ts) — khớp ESupervisorVerdict để
  // turn-resolver-run.ts so sánh đúng khi quyết định CONTINUE/REPLAN (trước
  // đây schema dùng literal "re-plan" có gạch nối, lệch với enum "replan",
  // khiến verdict REPLAN không bao giờ khớp — đã sửa ở orchestration.constant.ts).
  expectedVerdict: 'continue' | 'replan' | 'done';
  // Case mơ hồ có thật (dữ liệu chưa rõ đủ hay chưa) — không chấm đúng/sai,
  // chỉ quan sát verdict có ổn định giữa các lần chạy hay không.
  diagnostic?: boolean;
}

// Ghi chú thiết kế đầy đủ (WHY của từng case): xem
// slack-docs/Documents/Orchestration/code-notes/eval-supervisor-evaluate.dataset.md
// (tạo khi cần, theo đúng quy ước của eval-supervisor-plan.dataset.md).

const BASELINE_CASES: SupervisorEvaluateEvalCase[] = [
  {
    name: 'continue-step-succeeded-plan-still-valid',
    originalPrompt:
      'kiếm thông tin 5 diễn viên bất kì từ TMDB và mapping tương ứng sang các cột trong bảng users, rồi chèn vào bảng users',
    completedStep: {
      agent: 'tmdb_dynamic_1',
      task: 'Lấy thông tin 5 diễn viên bất kỳ từ TMDB',
      result:
        'Đã lấy được đủ 5 diễn viên: (1) id=31, name="Tom Hanks", popularity=45.2; (2) id=192, name="Morgan Freeman", popularity=38.1; (3) id=1892, name="Matt Damon", popularity=41.7; (4) id=6193, name="Leonardo DiCaprio", popularity=52.3; (5) id=3894, name="Christian Bale", popularity=33.6.',
    },
    remainingSteps: [
      {
        agent: 'sql_server',
        task: 'Chèn 5 diễn viên vừa lấy vào bảng users',
        mustExecute: true,
      },
    ],
    expectedVerdict: 'continue',
  },
  {
    name: 'replan-tool-returned-error',
    originalPrompt:
      'trong bảng users hiện có bao nhiêu dòng, rồi gửi kết quả đó qua Slack cho team',
    completedStep: {
      agent: 'sql_server',
      task: 'Đếm số dòng trong bảng users',
      result: 'Lỗi: không thể kết nối tới SQL Server (connection timeout).',
    },
    remainingSteps: [
      {
        agent: 'slack',
        task: 'Gửi số dòng bảng users vừa đếm được cho team qua Slack',
      },
    ],
    expectedVerdict: 'replan',
  },
  {
    name: 'replan-result-not-found-blocks-remaining-step',
    originalPrompt:
      'lấy giúp tôi email của khách hàng có mã KH-102, rồi gửi email chào mừng cho họ',
    completedStep: {
      agent: 'sql_server',
      task: 'Lấy email của khách hàng có mã KH-102',
      result:
        'Không tìm thấy khách hàng nào có mã KH-102 trong bảng customers.',
    },
    remainingSteps: [
      {
        agent: 'google_mail',
        task: 'Gửi email chào mừng tới địa chỉ vừa lấy được',
      },
    ],
    expectedVerdict: 'replan',
  },
  {
    name: 'done-early-remaining-step-not-mandatory',
    originalPrompt: 'top 3 phim đang thịnh hành từ TMDB là phim gì?',
    completedStep: {
      agent: 'tmdb_dynamic_1',
      task: 'Lấy top 3 phim đang thịnh hành',
      result:
        'Top 3 phim thịnh hành hiện nay: (1) Movie A, (2) Movie B, (3) Movie C — đã đủ dữ liệu trả lời câu hỏi gốc.',
    },
    remainingSteps: [
      {
        agent: 'tmdb_dynamic_1',
        task: 'Lấy thêm mô tả chi tiết từng phim nếu cần',
        mustExecute: false,
      },
    ],
    expectedVerdict: 'done',
  },
  {
    name: 'no-done-explicit-mustExecute-forces-continue',
    originalPrompt:
      'lấy top 3 phim đang thịnh hành từ TMDB rồi lưu vào bảng movie_stats trên SQL Server',
    completedStep: {
      agent: 'tmdb_dynamic_1',
      task: 'Lấy top 3 phim đang thịnh hành từ TMDB',
      result:
        'Top 3 phim thịnh hành: (1) Movie A, (2) Movie B, (3) Movie C — đã đủ dữ liệu để trả lời, kể cả khi bước lưu SQL chưa chạy.',
    },
    remainingSteps: [
      {
        agent: 'sql_server',
        task: 'Lưu 3 phim vừa lấy vào bảng movie_stats',
        mustExecute: true,
      },
    ],
    // accuracy_problem.md mục 14 — SUPERVISOR_EVALUATE_SCHEMA_NO_DONE loại hẳn
    // "done" khỏi enum khi còn bước mustExecute=true, nên dù dữ liệu tưởng đã
    // đủ, model KHÔNG THỂ chọn "done" ở lượt này.
    expectedVerdict: 'continue',
  },
  {
    name: 'no-done-keyword-guard-catches-missing-mustExecute-flag',
    originalPrompt:
      'lấy danh sách issue đang mở trên GitHub rồi chèn vào bảng issues trên SQL Server',
    completedStep: {
      agent: 'github',
      task: 'Lấy danh sách issue đang mở',
      result: 'Có 4 issue đang mở: #12, #15, #20, #22.',
    },
    remainingSteps: [
      // Cố tình KHÔNG set mustExecute — mô phỏng plan() bỏ sót field, để
      // pending-action-step.util.ts phải bắt bằng từ khoá ("Chèn") thay vì
      // dựa vào flag tường minh.
      {
        agent: 'sql_server',
        task: 'Chèn 4 issue vừa lấy vào bảng issues',
      },
    ],
    expectedVerdict: 'continue',
  },
  {
    name: 'continue-partial-result-genuinely-exhaustive-not-an-error',
    originalPrompt:
      'lấy thông tin 10 khách hàng mới nhất từ bảng customers rồi gửi báo cáo qua Slack',
    completedStep: {
      agent: 'sql_server',
      task: 'Lấy thông tin 10 khách hàng mới nhất',
      result:
        'Bảng customers chỉ có đúng 4 dòng thoả điều kiện (không phải lỗi, đã quét hết bảng): KH-201, KH-202, KH-203, KH-204.',
    },
    remainingSteps: [
      {
        agent: 'slack',
        task: 'Gửi báo cáo danh sách khách hàng vừa lấy qua Slack',
      },
    ],
    expectedVerdict: 'continue',
  },
];

// Case mơ hồ thật — quan sát ổn định (mục 6 accuracy.v2.md: có đáng hỏi lại
// user khi evaluate() cũng không chắc hay không), không chấm đúng/sai.
const DIAGNOSTIC_CASES: SupervisorEvaluateEvalCase[] = [
  {
    name: 'diagnostic-partial-result-could-be-error-or-exhaustive',
    diagnostic: true,
    originalPrompt:
      'lấy thông tin 10 khách hàng mới nhất từ bảng customers rồi gửi báo cáo qua Slack',
    completedStep: {
      agent: 'sql_server',
      task: 'Lấy thông tin 10 khách hàng mới nhất',
      // Không nói rõ là đã quét hết bảng hay do lỗi/thiếu — mơ hồ thật.
      result: 'Chỉ lấy được 6 khách hàng: KH-201 đến KH-206.',
    },
    remainingSteps: [
      {
        agent: 'slack',
        task: 'Gửi báo cáo 10 khách hàng vừa lấy qua Slack',
      },
    ],
    expectedVerdict: 'continue',
  },
  {
    name: 'diagnostic-borderline-sufficiency-two-part-question',
    diagnostic: true,
    originalPrompt:
      'top 3 phim thịnh hành trên TMDB là phim gì, và điểm rating trung bình của chúng là bao nhiêu?',
    completedStep: {
      agent: 'tmdb_dynamic_1',
      task: 'Lấy top 3 phim đang thịnh hành',
      // Chỉ trả lời được nửa câu hỏi gốc (tên phim), còn rating trung bình
      // chưa có — mustExecute không set, không có từ khoá tính toán rõ ràng
      // trong remainingSteps.task để pending-action-step.util.ts bắt được.
      result: 'Top 3 phim thịnh hành: (1) Movie A, (2) Movie B, (3) Movie C.',
    },
    remainingSteps: [
      {
        agent: 'tmdb_dynamic_1',
        task: 'Lấy thêm rating của từng phim nếu cần',
        mustExecute: false,
      },
    ],
    expectedVerdict: 'continue',
  },
];

export const SUPERVISOR_EVALUATE_EVAL_CASES: SupervisorEvaluateEvalCase[] = [
  ...BASELINE_CASES,
  ...DIAGNOSTIC_CASES,
];
