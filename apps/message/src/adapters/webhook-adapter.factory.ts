import { GithubAdapter } from './github.adapter';
import { TrelloAdapter } from './trello.adapter';
import { JiraAdapter } from './jira.adapter';
import { SentryAdapter } from './sentry.adapter';
import { IWebhookAdapter } from './webhook-adapter.interface';

export class WebhookAdapterFactory {
  static getAdapter(appType: string): IWebhookAdapter {
    switch (appType.toLowerCase()) {
      case 'github':
        return new GithubAdapter();
      case 'trello':
        return new TrelloAdapter();
      case 'jira':
        return new JiraAdapter();
      case 'sentry':
        return new SentryAdapter();
      default:
        throw new Error(`Unsupported app type: ${appType}`);
    }
  }
}
