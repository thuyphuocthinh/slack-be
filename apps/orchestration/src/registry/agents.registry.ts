/**
 * Khai tĩnh 1 dòng/agent — chỉ nơi agent chạy + provider tương ứng.
 * KHÔNG khai tool ở đây — tool list lấy trực tiếp qua MCP `listTools()`
 * (xem McpClientService) để luôn khớp đúng với agent thật, không phải
 * bản copy tay dễ lệch.
 */
export interface AgentRegistryEntry {
  label: string;
  endpoint: string | undefined;
}

export const AGENT_REGISTRY: Record<string, AgentRegistryEntry> = {
  sql_server: {
    label: 'SQL Server',
    endpoint: process.env.AGENT_SQL_SERVER_URL,
  },
  // Giai đoạn 2, Step 4 — agent thứ 2, repo riêng `freelancer/agent_github`.
  github: {
    label: 'GitHub',
    endpoint: process.env.AGENT_GITHUB_URL,
  },
  google_sheets: {
    label: 'Google Sheets',
    endpoint: process.env.AGENT_GOOGLE_SHEETS_URL,
  },
  google_docs: {
    label: 'Google Docs',
    endpoint: process.env.AGENT_GOOGLE_DOCS_URL,
  },
  google_mail: {
    label: 'Gmail',
    endpoint: process.env.AGENT_GOOGLE_MAIL_URL,
  },
  google_drive: {
    label: 'Google Drive',
    endpoint: process.env.AGENT_GOOGLE_DRIVE_URL,
  },
  google_calendar: {
    label: 'Google Calendar',
    endpoint: process.env.AGENT_GOOGLE_CALENDAR_URL,
  },
  slack: {
    label: 'Slack',
    endpoint: process.env.AGENT_SLACK_URL,
  },
  notion: {
    label: 'Notion',
    endpoint: process.env.AGENT_NOTION_URL,
  },
};
