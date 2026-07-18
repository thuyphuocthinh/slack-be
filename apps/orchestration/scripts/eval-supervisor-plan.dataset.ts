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
];
