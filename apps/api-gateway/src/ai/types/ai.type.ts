export interface IAiMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface IAiChatRequest {
  messages: IAiMessage[];
  workspaceId?: string;
}

export interface IAiChatResponse {
  text: string;
}

export interface IAiIndexDocumentResponse {
  documentName: string;
  chunksCount: number;
}

export interface IAiDocumentSummary {
  documentName: string;
  chunksCount: number;
  createdAt: Date;
}
