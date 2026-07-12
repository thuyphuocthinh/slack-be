import { OAuth2RefreshRequestFormat } from './agentic-openapi-parser';

// Đa số token endpoint (Google, Microsoft, HubSpot, Salesforce, Spotify...) chấp nhận
// form-urlencoded — chỉ vài nền tảng như Atlassian (Jira/Confluence) bắt buộc JSON body.
const JSON_REFRESH_HOSTNAMES = ['auth.atlassian.com'];

export function inferOAuth2RefreshFormat(
  tokenUrl?: string,
): OAuth2RefreshRequestFormat {
  if (!tokenUrl) return 'form';
  try {
    return JSON_REFRESH_HOSTNAMES.includes(new URL(tokenUrl).hostname)
      ? 'json'
      : 'form';
  } catch {
    return 'form';
  }
}
