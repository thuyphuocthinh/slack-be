import { IWebhookAdapter, ITransformedWebhookPayload } from './webhook-adapter.interface';

export class JiraAdapter implements IWebhookAdapter {
  transform(payload: Record<string, unknown>): ITransformedWebhookPayload | null {
    const issue = payload.issue as Record<string, any>;
    const event = payload.webhookEvent as string;
    
    let title = 'Jira Event Received';
    if (issue && issue.key && event) {
       title = `Jira: ${issue.key} - ${event}`;
    } else if (event) {
       title = `Jira: ${event}`;
    }

    const jsonString = JSON.stringify(payload, null, 2);
    const tiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'bold' }],
              text: `🔷 ${title}`,
            },
          ],
        },
        {
          type: 'codeBlock',
          content: [
            {
              type: 'text',
              text: jsonString,
            },
          ],
        },
      ],
    };

    return {
      text: title,
      content: JSON.stringify(tiptapDoc),
    };
  }
}
