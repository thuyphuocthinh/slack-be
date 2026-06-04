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

export interface IAiIndexDocumentRequest {
  fileContent: string;
  fileName: string;
  workspaceId: string;
}

export interface IAiIndexDocumentResponse {
  documentName: string;
  chunksCount: number;
}

export interface IAiListDocumentsRequest {
  workspaceId: string;
}

export interface IAiDocumentSummary {
  documentName: string;
  chunksCount: number;
  createdAt: Date;
}

export interface IAiDeleteDocumentRequest {
  workspaceId: string;
  documentName: string;
}
