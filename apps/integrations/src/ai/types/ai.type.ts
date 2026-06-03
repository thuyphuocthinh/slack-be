export interface IAiMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface IAiChatRequest {
  messages: IAiMessage[];
}

export interface IAiChatResponse {
  text: string;
}
