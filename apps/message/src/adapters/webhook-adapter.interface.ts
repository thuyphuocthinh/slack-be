export interface ITransformedWebhookPayload {
  text?: string;
  content?: string;
  attachments?: Record<string, unknown>[];
}

export interface IWebhookAdapter {
  transform(payload: Record<string, unknown>): ITransformedWebhookPayload | null;
}
