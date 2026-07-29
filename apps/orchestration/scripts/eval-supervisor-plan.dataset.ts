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
  expectedAgents?: string[];
  // Xem code-notes/eval-supervisor-plan.dataset.md
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

// Xem code-notes/eval-supervisor-plan.dataset.md
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

// Ghi chú thiết kế đầy đủ (WHY của từng case): slack-docs/Documents/Orchestration/code-notes/eval-supervisor-plan.dataset.md
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
  // mục 6 (uncertainty-clarification) trong accuracy.v2.md — xem code-notes/eval-supervisor-plan.dataset.md ---

  {
    name: 'three-step-chain-tmdb-sql-slack',
    prompt:
      'lấy top 3 phim đang thịnh hành từ TMDB, tính điểm rating trung bình rồi lưu kết quả vào bảng movie_stats trên SQL Server, xong rồi báo cho team qua Slack',
    agents: [TMDB_AGENT, SQL_SERVER_AGENT, SLACK_AGENT],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['tmdb_dynamic_1', 'sql_server', 'slack'],
  },
  {
    name: 'similar-purpose-agents-sheets-vs-sql',
    prompt: 'cập nhật số liệu doanh số tháng này vào Sheet tổng hợp giúp tôi',
    agents: [SQL_SERVER_AGENT, GOOGLE_SHEETS_AGENT],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['google_sheets'],
  },
  {
    name: 'ambiguous-two-similar-note-agents',
    diagnostic: true,
    prompt: 'lưu thông tin này lại giúp tôi',
    agents: [GOOGLE_DOCS_AGENT, NOTION_AGENT],
    rounds: [],
    expectedAction: 'plan',
  },
  {
    name: 'ambiguous-two-generic-dynamic-providers',
    diagnostic: true,
    prompt: 'lấy giúp tôi dữ liệu mới nhất',
    agents: [GENERIC_DYNAMIC_PROVIDER_A, GENERIC_DYNAMIC_PROVIDER_B],
    rounds: [],
    expectedAction: 'plan',
  },
  {
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

  // --- accuracy_problem.md mục 9.3 — xem code-notes/eval-supervisor-plan.dataset.md ---

  {
    name: 'muc-9.3-rescue-secondary-agent-named-notion',
    prompt:
      'lấy thông tin chi tiết về 3 bộ phim đang thịnh hành nhất hiện nay từ TMDB, bao gồm độ phổ biến, điểm đánh giá trung bình, ngày phát hành và tóm tắt nội dung, rồi lưu bản tóm tắt đó vào Notion',
    agents: [
      TMDB_AGENT,
      SQL_SERVER_AGENT,
      GITHUB_AGENT,
      GOOGLE_DOCS_AGENT,
      GOOGLE_SHEETS_AGENT,
      GOOGLE_MAIL_AGENT,
      GOOGLE_DRIVE_AGENT,
      GOOGLE_CALENDAR_AGENT,
      SLACK_AGENT,
      NOTION_AGENT,
    ],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['tmdb_dynamic_1', 'notion'],
  },
  {
    name: 'muc-9.3-rescue-secondary-agent-named-google-sheets',
    prompt:
      'truy vấn toàn bộ đơn hàng trong bảng orders, tính tổng doanh thu theo từng danh mục sản phẩm, lọc riêng theo trạng thái đã thanh toán trong tháng này, rồi cập nhật số liệu tổng hợp đó vào Google Sheet',
    agents: [
      SQL_SERVER_AGENT,
      TMDB_AGENT,
      GITHUB_AGENT,
      GOOGLE_DOCS_AGENT,
      GOOGLE_MAIL_AGENT,
      GOOGLE_DRIVE_AGENT,
      GOOGLE_CALENDAR_AGENT,
      SLACK_AGENT,
      NOTION_AGENT,
      GOOGLE_SHEETS_AGENT,
    ],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['sql_server', 'google_sheets'],
  },
  {
    name: 'muc-9.3-residual-risk-secondary-agent-unnamed',
    diagnostic: true,
    prompt:
      'truy vấn toàn bộ đơn hàng trong bảng orders, tính tổng doanh thu theo từng danh mục sản phẩm, lọc riêng theo trạng thái đã thanh toán trong tháng này, rồi lưu kết quả tổng hợp lại giúp tôi',
    agents: [
      SQL_SERVER_AGENT,
      TMDB_AGENT,
      GITHUB_AGENT,
      GOOGLE_DOCS_AGENT,
      GOOGLE_MAIL_AGENT,
      GOOGLE_DRIVE_AGENT,
      GOOGLE_CALENDAR_AGENT,
      SLACK_AGENT,
      NOTION_AGENT,
      GOOGLE_SHEETS_AGENT,
    ],
    rounds: [],
    expectedAction: 'plan',
  },

  // --- ver3.md mục 5 — tín hiệu bực bội (regex) không được khiến Supervisor
  // hiểu lầm thành "user chỉ đang than phiền" và trả lời "respond" thay vì
  // vẫn thực thi đúng agent mà câu đó yêu cầu ---

  {
    name: 'ver3-muc5-frustration-prompt-still-resolves-correct-agent',
    prompt: 'sao vẫn lỗi hoài vậy, chèn lại dữ liệu vào Google Sheet giúp tôi',
    agents: [GOOGLE_SHEETS_AGENT, SQL_SERVER_AGENT],
    rounds: [],
    expectedAction: 'plan',
    expectedAgents: ['google_sheets'],
  },
];
