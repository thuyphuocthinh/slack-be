import { ERefreshFormat } from '@slack/constants';

// Đa số token endpoint (Google, Microsoft, HubSpot, Salesforce, Spotify...) chấp nhận
// form-urlencoded — chỉ vài nền tảng như Atlassian (Jira/Confluence) bắt buộc JSON body.
const JSON_REFRESH_HOSTNAMES = ['auth.atlassian.com'];

export function inferOAuth2RefreshFormat(tokenUrl?: string): ERefreshFormat {
  if (!tokenUrl) return ERefreshFormat.FORM;
  try {
    return JSON_REFRESH_HOSTNAMES.includes(new URL(tokenUrl).hostname)
      ? ERefreshFormat.JSON
      : ERefreshFormat.FORM;
  } catch {
    return ERefreshFormat.FORM;
  }
}
