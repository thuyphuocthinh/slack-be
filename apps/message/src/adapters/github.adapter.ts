import { IWebhookAdapter, ITransformedWebhookPayload } from './webhook-adapter.interface';

export class GithubAdapter implements IWebhookAdapter {
  transform(payload: Record<string, unknown>): ITransformedWebhookPayload | null {
    const pr = payload.pull_request || payload.pullRequest;
    
    // Handle Pull Request Opened
    if (payload.action === 'opened' && pr) {
      const prData = pr as Record<string, any>;
      const title = prData.title || 'Untitled PR';
      const url = prData.html_url || prData.htmlUrl || '#';
      
      const tiptapDoc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                marks: [{ type: 'bold' }],
                text: '🚀 New Pull Request: ',
              },
              {
                type: 'text',
                marks: [{ type: 'link', attrs: { href: url, target: '_blank' } }],
                text: title,
              },
            ],
          },
        ],
      };
      
      return {
        text: `New Pull Request: ${title}`,
        content: JSON.stringify(tiptapDoc),
      };
    }

    // Default fallback
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
              text: '🔔 Github Event Received:',
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
      text: `Github Event Received`,
      content: JSON.stringify(tiptapDoc),
    };
  }
}
