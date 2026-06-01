import { IWebhookAdapter, ITransformedWebhookPayload } from './webhook-adapter.interface';

export class GithubAdapter implements IWebhookAdapter {
  transform(payload: Record<string, unknown>): ITransformedWebhookPayload | null {
    // Example basic transformation for push/pull request
    if (payload.action === 'opened' && payload.pull_request) {
      const pr = payload.pull_request as Record<string, any>;
      return {
        text: `New Pull Request: ${pr.title}`,
        content: `New Pull Request: ${pr.title}`,
        // Map to attachments or blocks if needed
      };
    }
    
    // Default fallback
    return {
      text: `Github Event Received`,
      content: JSON.stringify(payload),
    };
  }
}
