import { IWebhookAdapter, ITransformedWebhookPayload } from './webhook-adapter.interface';

export class SentryAdapter implements IWebhookAdapter {
  transform(payload: Record<string, unknown>): ITransformedWebhookPayload | null {
    const project_name = payload.project_name as string;
    const message = payload.message as string;
    
    let title = 'Sentry Event Received';
    if (project_name && message) {
       title = `Sentry [${project_name}]: ${message}`;
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
              text: `🚨 ${title}`,
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
