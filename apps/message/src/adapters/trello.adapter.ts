import { IWebhookAdapter, ITransformedWebhookPayload } from './webhook-adapter.interface';

export class TrelloAdapter implements IWebhookAdapter {
  transform(payload: Record<string, unknown>): ITransformedWebhookPayload | null {
    const action = payload.action as Record<string, any>;
    
    let title = 'Trello Event Received';
    if (action && action.display && action.display.translationKey) {
       title = `Trello: ${action.display.translationKey}`;
    } else if (action && action.type) {
       title = `Trello: ${action.type}`;
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
              text: `📋 ${title}`,
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
