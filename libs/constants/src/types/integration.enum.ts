export enum IntegrationProvider {
  GOOGLE = 'google',
  ZOOM = 'zoom',
  SLACK = 'slack',
  GITHUB = 'github',
  NOTION = 'notion',
  TRELLO = 'trello',
  JIRA = 'jira',
  MICROSOFT = 'microsoft',
  LINE = 'line',
  DISCORD = 'discord',
  FIGMA = 'figma',
  DROPBOX = 'dropbox',
}

export enum IntegrationTargetType {
  USER = 'user',
  WORKSPACE = 'workspace',
}

export enum IntegrationStatus {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
}

export enum CalendarSyncStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}
