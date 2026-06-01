import { GithubAdapter } from './github.adapter';
import { IWebhookAdapter } from './webhook-adapter.interface';

export class WebhookAdapterFactory {
  static getAdapter(appType: string): IWebhookAdapter {
    switch (appType.toLowerCase()) {
      case 'github':
        return new GithubAdapter();
      // Add other cases like 'trello' here
      default:
        throw new Error(`Unsupported app type: ${appType}`);
    }
  }
}
