import { inferOAuth2RefreshFormat } from './oauth2-refresh-format.util';

describe('inferOAuth2RefreshFormat', () => {
  it('returns "json" for Atlassian\'s token endpoint (Jira/Confluence)', () => {
    expect(
      inferOAuth2RefreshFormat('https://auth.atlassian.com/oauth/token'),
    ).toBe('json');
  });

  it('returns "form" for common providers (Google, Microsoft, HubSpot, Salesforce, Spotify)', () => {
    expect(
      inferOAuth2RefreshFormat('https://oauth2.googleapis.com/token'),
    ).toBe('form');
    expect(
      inferOAuth2RefreshFormat(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      ),
    ).toBe('form');
    expect(
      inferOAuth2RefreshFormat('https://api.hubapi.com/oauth/v1/token'),
    ).toBe('form');
    expect(
      inferOAuth2RefreshFormat(
        'https://login.salesforce.com/services/oauth2/token',
      ),
    ).toBe('form');
    expect(
      inferOAuth2RefreshFormat('https://accounts.spotify.com/api/token'),
    ).toBe('form');
  });

  it('returns "form" when tokenUrl is missing or unparseable', () => {
    expect(inferOAuth2RefreshFormat(undefined)).toBe('form');
    expect(inferOAuth2RefreshFormat('not-a-url')).toBe('form');
  });
});
