import { AvailableAgentDto } from '../src/dto/supervisor.dto';

export const TMDB_AGENT: AvailableAgentDto = {
  provider: 'tmdb_dynamic_1',
  label: 'TMDB',
  description:
    'Hệ thống/API mở rộng (Custom Swagger). TRỌNG TÂM: Hãy ưu tiên chọn agent này nếu yêu cầu liên quan đến các từ khóa hoặc dữ liệu thuộc về hệ thống "TMDB" (URL tham khảo: https://api.themoviedb.org/3/openapi.json).',
};

export const SQL_SERVER_AGENT: AvailableAgentDto = {
  provider: 'sql_server',
  label: 'SQL Server',
  description: 'Truy vấn schema và dữ liệu trên SQL Server của bạn.',
};

export const GITHUB_AGENT: AvailableAgentDto = {
  provider: 'github',
  label: 'GitHub',
  description: 'Truy cập repository, issue, pull request trên GitHub.',
};

export const GOOGLE_DOCS_AGENT: AvailableAgentDto = {
  provider: 'google_docs',
  label: 'Google Docs',
  description: 'Đọc và chỉnh sửa nội dung Google Docs.',
};

export const GOOGLE_SHEETS_AGENT: AvailableAgentDto = {
  provider: 'google_sheets',
  label: 'Google Sheets',
  description: 'Đọc và chỉnh sửa dữ liệu trên Google Sheets.',
};

export const GOOGLE_MAIL_AGENT: AvailableAgentDto = {
  provider: 'google_mail',
  label: 'Gmail',
  description: 'Đọc, soạn và gửi email qua Gmail của bạn.',
};

export const GOOGLE_DRIVE_AGENT: AvailableAgentDto = {
  provider: 'google_drive',
  label: 'Google Drive',
  description: 'Truy cập file và thư mục trên Google Drive.',
};

export const GOOGLE_CALENDAR_AGENT: AvailableAgentDto = {
  provider: 'google_calendar',
  label: 'Google Calendar',
  description: 'Đọc và quản lý sự kiện trên Google Calendar của bạn.',
};

export const SLACK_AGENT: AvailableAgentDto = {
  provider: 'slack',
  label: 'Slack',
  description: 'Tương tác với workspace Slack khác của bạn.',
};

export const NOTION_AGENT: AvailableAgentDto = {
  provider: 'notion',
  label: 'Notion',
  description: 'Đọc và chỉnh sửa trang/database trên Notion.',
};

// Xem code-notes/eval-supervisor-plan.dataset.md
export const GENERIC_DYNAMIC_PROVIDER_A: AvailableAgentDto = {
  provider: 'dynamic_internal_api_a',
  label: 'Internal API A',
  description:
    'Hệ thống/API mở rộng (Custom Swagger). TRỌNG TÂM: Hãy ưu tiên chọn agent này nếu yêu cầu liên quan đến các từ khóa hoặc dữ liệu thuộc về hệ thống "Internal API A".',
};

export const GENERIC_DYNAMIC_PROVIDER_B: AvailableAgentDto = {
  provider: 'dynamic_internal_api_b',
  label: 'Internal API B',
  description:
    'Hệ thống/API mở rộng (Custom Swagger). TRỌNG TÂM: Hãy ưu tiên chọn agent này nếu yêu cầu liên quan đến các từ khóa hoặc dữ liệu thuộc về hệ thống "Internal API B".',
};
