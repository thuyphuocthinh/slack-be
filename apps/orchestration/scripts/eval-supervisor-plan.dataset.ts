import {
  AvailableAgentDto,
  SupervisorRoundDto,
} from '../src/dto/supervisor.dto';
import { ChatHistoryTurnDto } from '../src/dto/message-client.dto';

export interface SupervisorPlanEvalCase {
  name: string;
  prompt: string;
  agents: AvailableAgentDto[];
  rounds?: SupervisorRoundDto[];
  history?: ChatHistoryTurnDto[];
  expectedAction: 'plan' | 'respond';
  // Chỉ áp dụng khi expectedAction === 'plan' — đúng thứ tự agent kỳ vọng
  // trong `steps` (Tool Correctness — so khớp CỨNG, không cần LLM-judge).
  expectedAgents?: string[];
  // Giai đoạn Accuracy v2, mục 5/6 — case KHÔNG có 1 đáp án đúng duy nhất (VD
  // prompt mơ hồ giữa 2+ agent hợp lý ngang nhau). Không chấm pass/fail —
  // chạy lại N lần (xem eval-supervisor-plan.ts) chỉ để QUAN SÁT: plan() có
  // luôn chọn ổn định 1 agent, hay đổi qua lại giữa các agent hợp lý (tín hiệu
  // cho self-consistency, mục 5) và có case nào rõ ràng nên hỏi lại user thay
  // vì tự đoán (tín hiệu cho uncertainty-clarification, mục 6).
  diagnostic?: boolean;
}

const TMDB_AGENT: AvailableAgentDto = {
  provider: 'tmdb_dynamic_1',
  label: 'TMDB',
  description:
    'Hệ thống/API mở rộng (Custom Swagger). TRỌNG TÂM: Hãy ưu tiên chọn agent này nếu yêu cầu liên quan đến các từ khóa hoặc dữ liệu thuộc về hệ thống "TMDB" (URL tham khảo: https://api.themoviedb.org/3/openapi.json).',
};

const SQL_SERVER_AGENT: AvailableAgentDto = {
  provider: 'sql_server',
  label: 'SQL Server',
  description: 'Truy vấn schema và dữ liệu trên SQL Server của bạn.',
};

const GITHUB_AGENT: AvailableAgentDto = {
  provider: 'github',
  label: 'GitHub',
  description: 'Truy cập repository, issue, pull request trên GitHub.',
};

const GOOGLE_DOCS_AGENT: AvailableAgentDto = {
  provider: 'google_docs',
  label: 'Google Docs',
  description: 'Đọc và chỉnh sửa nội dung Google Docs.',
};

const GOOGLE_SHEETS_AGENT: AvailableAgentDto = {
  provider: 'google_sheets',
  label: 'Google Sheets',
  description: 'Đọc và chỉnh sửa dữ liệu trên Google Sheets.',
};

const GOOGLE_MAIL_AGENT: AvailableAgentDto = {
  provider: 'google_mail',
  label: 'Gmail',
  description: 'Đọc, soạn và gửi email qua Gmail của bạn.',
};

const GOOGLE_DRIVE_AGENT: AvailableAgentDto = {
  provider: 'google_drive',
  label: 'Google Drive',
  description: 'Truy cập file và thư mục trên Google Drive.',
};

const GOOGLE_CALENDAR_AGENT: AvailableAgentDto = {
  provider: 'google_calendar',
  label: 'Google Calendar',
  description: 'Đọc và quản lý sự kiện trên Google Calendar của bạn.',
};

const SLACK_AGENT: AvailableAgentDto = {
  provider: 'slack',
  label: 'Slack',
  description: 'Tương tác với workspace Slack khác của bạn.',
};

const NOTION_AGENT: AvailableAgentDto = {
  provider: 'notion',
  label: 'Notion',
  description: 'Đọc và chỉnh sửa trang/database trên Notion.',
};

// 2 dynamic provider mô tả gần như GIỐNG HỆT nhau (dynamic agent thường được
// user tự đặt tên/mô tả sơ sài) — stress test khả năng phân biệt khi mô tả
// không đủ tín hiệu, KHÔNG đại diện cho 1 hệ thống thật cụ thể nào.
const GENERIC_DYNAMIC_PROVIDER_A: AvailableAgentDto = {
  provider: 'dynamic_internal_api_a',
  label: 'Internal API A',
  description:
    'Hệ thống/API mở rộng (Custom Swagger). TRỌNG TÂM: Hãy ưu tiên chọn agent này nếu yêu cầu liên quan đến các từ khóa hoặc dữ liệu thuộc về hệ thống "Internal API A".',
};

const GENERIC_DYNAMIC_PROVIDER_B: AvailableAgentDto = {
  provider: 'dynamic_internal_api_b',
  label: 'Internal API B',
  description:
    'Hệ thống/API mở rộng (Custom Swagger). TRỌNG TÂM: Hãy ưu tiên chọn agent này nếu yêu cầu liên quan đến các từ khóa hoặc dữ liệu thuộc về hệ thống "Internal API B".',
};

/**
 * Giai đoạn System, mục "Accuracy v2" (`accuracy.v2.md`, mục 1) — golden
 * dataset đo Tool Correctness của `SupervisorService.plan()`: agent đúng,
 * đúng thứ tự, so khớp CỨNG (không cần LLM-judge). Chạy qua
 * `scripts/eval-supervisor-plan.ts` mỗi khi đổi SUPERVISOR_PLANNING_PROMPT,
 * model, hay bất kỳ cơ chế nào ảnh hưởng tới plan() — KHÔNG merge nếu %
 * match giảm so với lần chạy trước.
 *
 * 2 case đầu tái hiện ĐÚNG sự cố thật đã gặp (xem accuracy.md — TMDB → bảng
 * `users`): case 1 là turn MỚI (phải lập kế hoạch ĐỦ 2 bước ngay từ đầu,
 * đúng như ví dụ few-shot "lấy A rồi ghi B" trong SUPERVISOR_PLANNING_PROMPT
 * — không chỉ delegate bước đầu rồi bỏ ngỏ); case 2 là lúc RE-PLAN sau khi
 * bước TMDB đã chạy xong (đây chính xác là bước mà code cũ chọn nhầm
 * `account-add-favorite` thay vì `sql_server`).
 */
export const SUPERVISOR_PLAN_EVAL_CASES: SupervisorPlanEvalCase[] = [
  {
    name: 'tmdb-then-sql-fresh-turn',
    prompt:
      'kiếm thông tin 5 diễn viên bất kì từ TMDB và mapping tương ứng sang các cột trong bảng users, rồi chèn vào bảng users',
    agents: [TMDB_AGENT, SQL_SERVER_AGENT],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['tmdb_dynamic_1', 'sql_server'],
  },
  {
    name: 'tmdb-then-sql-after-tmdb-done',
    prompt:
      'kiếm thông tin 5 diễn viên bất kì từ TMDB và mapping tương ứng sang các cột trong bảng users, rồi chèn vào bảng users',
    agents: [TMDB_AGENT, SQL_SERVER_AGENT],
    rounds: [
      {
        agent: 'tmdb_dynamic_1',
        task: 'Lấy thông tin 5 diễn viên bất kỳ từ TMDB',
        result:
          'Đã lấy được 5 diễn viên: (1) id=31, name="Tom Hanks", popularity=45.2; (2) id=192, name="Morgan Freeman", popularity=38.1; (3) id=1892, name="Matt Damon", popularity=41.7; (4) id=6193, name="Leonardo DiCaprio", popularity=52.3; (5) id=3894, name="Christian Bale", popularity=33.6.',
      },
    ],
    expectedAction: 'plan',
    expectedAgents: ['sql_server'],
  },
  {
    name: 'single-agent-sql-only',
    prompt: 'trong bảng users hiện có bao nhiêu dòng?',
    agents: [SQL_SERVER_AGENT, GITHUB_AGENT],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['sql_server'],
  },
  {
    name: 'single-agent-github-only-among-many',
    prompt: 'liệt kê giúp mình các issue đang mở trong repo',
    agents: [SQL_SERVER_AGENT, GITHUB_AGENT, GOOGLE_DOCS_AGENT, TMDB_AGENT],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['github'],
  },
  {
    // Giai đoạn Accuracy v2, mục 2 — agent-level Tool RAG. 9 agent (vượt
    // MAX_AGENTS_BEFORE_RANKING=8) — chỉ đúng 1 cái liên quan tới GitHub, còn
    // lại là các hệ thống khác không liên quan. Case này gọi embedding THẬT
    // (không mock), khác với các case trên (agents ít, không kích hoạt ranking).
    name: 'agent-level-rag-github-relevant-among-many',
    prompt: 'liệt kê giúp mình các issue đang mở trong repo trên GitHub',
    agents: [
      SQL_SERVER_AGENT,
      GOOGLE_DOCS_AGENT,
      GOOGLE_SHEETS_AGENT,
      GOOGLE_MAIL_AGENT,
      GOOGLE_DRIVE_AGENT,
      GOOGLE_CALENDAR_AGENT,
      SLACK_AGENT,
      NOTION_AGENT,
      GITHUB_AGENT,
    ],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['github'],
  },
  {
    name: 'respond-no-data-needed',
    prompt: 'chào bạn, hôm nay khoẻ không?',
    agents: [SQL_SERVER_AGENT, GITHUB_AGENT],
    rounds: [],
    expectedAction: 'respond',
  },
  {
    name: 'respond-no-agents-connected',
    prompt: 'trong bảng users hiện có bao nhiêu dòng?',
    agents: [],
    rounds: [],
    expectedAction: 'respond',
  },

  // --- Case khó hơn, thêm để dò tín hiệu cho mục 5 (self-consistency) và
  // mục 6 (uncertainty-clarification) trong accuracy.v2.md ---

  {
    // Kế hoạch 3 BƯỚC (khó hơn hẳn few-shot 2-bước trong SUPERVISOR_PLANNING_PROMPT)
    // — TMDB → SQL Server → Slack. Nếu plan() chỉ trả về 1-2 bước đầu (bỏ sót
    // bước thông báo Slack) hoặc thứ tự sai, đây là tín hiệu plan() không ổn
    // định với kế hoạch dài — ủng hộ mục 5 (self-consistency).
    name: 'three-step-chain-tmdb-sql-slack',
    prompt:
      'lấy top 3 phim đang thịnh hành từ TMDB, tính điểm rating trung bình rồi lưu kết quả vào bảng movie_stats trên SQL Server, xong rồi báo cho team qua Slack',
    agents: [TMDB_AGENT, SQL_SERVER_AGENT, SLACK_AGENT],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['tmdb_dynamic_1', 'sql_server', 'slack'],
  },
  {
    // 2 agent CÙNG dạng "lưu trữ dữ liệu dạng bảng" — task nhắc rõ "Sheet" nên
    // phải chọn đúng google_sheets, KHÔNG lẫn sang sql_server dù cả 2 đều liên
    // quan tới "dữ liệu"/"bảng". Stress test độ chính xác khi 2 lựa chọn cùng
    // nhóm chức năng, không phải phân biệt 2 domain hoàn toàn khác nhau.
    name: 'similar-purpose-agents-sheets-vs-sql',
    prompt: 'cập nhật số liệu doanh số tháng này vào Sheet tổng hợp giúp tôi',
    agents: [SQL_SERVER_AGENT, GOOGLE_SHEETS_AGENT],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['google_sheets'],
  },
  {
    // Diagnostic — prompt KHÔNG có tín hiệu nào để phân biệt Google Docs với
    // Notion (cả 2 đều "lưu ghi chú"). Không chấm đúng/sai — chỉ quan sát: có
    // luôn chọn 1 agent cố định (ổn định nhưng có thể luôn sai), đổi qua lại
    // giữa 2 lựa chọn (ủng hộ mục 5), hay lẽ ra nên hỏi lại user (ủng hộ mục 6).
    name: 'ambiguous-two-similar-note-agents',
    diagnostic: true,
    prompt: 'lưu thông tin này lại giúp tôi',
    agents: [GOOGLE_DOCS_AGENT, NOTION_AGENT],
    rounds: [],
    expectedAction: 'plan',
  },
  {
    // Diagnostic — 2 dynamic provider mô tả gần như giống hệt (thường gặp
    // thật khi user tự đặt tên/mô tả sơ sài cho custom API), prompt hoàn toàn
    // trung tính. Cùng mục đích quan sát như case trên.
    name: 'ambiguous-two-generic-dynamic-providers',
    diagnostic: true,
    prompt: 'lấy giúp tôi dữ liệu mới nhất',
    agents: [GENERIC_DYNAMIC_PROVIDER_A, GENERIC_DYNAMIC_PROVIDER_B],
    rounds: [],
    expectedAction: 'plan',
  },
  {
    // Kiểm tra bias THỨ TỰ liệt kê — y hệt 'ambiguous-two-similar-note-agents'
    // nhưng đảo vị trí 2 agent trong mảng. Nếu lựa chọn cũng ĐẢO theo (chọn
    // Notion thay vì Google Docs), đó là bằng chứng plan() đang thiên vị theo
    // VỊ TRÍ trong danh sách chứ không phải suy luận ngữ nghĩa thật — càng
    // củng cố lý do cần mục 6 (hỏi lại thay vì tự đoán mù).
    name: 'ambiguous-two-similar-note-agents-order-swapped',
    diagnostic: true,
    prompt: 'lưu thông tin này lại giúp tôi',
    agents: [NOTION_AGENT, GOOGLE_DOCS_AGENT],
    rounds: [],
    expectedAction: 'plan',
  },
  {
    name: 'ambiguous-two-generic-dynamic-providers-order-swapped',
    diagnostic: true,
    prompt: 'lấy giúp tôi dữ liệu mới nhất',
    agents: [GENERIC_DYNAMIC_PROVIDER_B, GENERIC_DYNAMIC_PROVIDER_A],
    rounds: [],
    expectedAction: 'plan',
  },
];
