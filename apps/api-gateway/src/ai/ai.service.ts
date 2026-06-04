import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { INTEGRATIONS_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import {
  IAiChatRequest,
  IAiChatResponse,
  IAiIndexDocumentResponse,
  IAiDocumentSummary,
} from './types/ai.type';
import { Observable, lastValueFrom } from 'rxjs';

@Injectable()
export class AiService {
  constructor(
    @Inject(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE) private readonly integrationsClient: ClientProxy,
  ) {}

  chat(payload: IAiChatRequest): Observable<IAiChatResponse> {
    return this.integrationsClient.send<IAiChatResponse, IAiChatRequest>(
      INTEGRATIONS_MESSAGE_PATTERNS.AI_CHAT,
      payload,
    );
  }

  async indexDocument(
    fileBuffer: Buffer,
    fileName: string,
    workspaceId: string,
  ): Promise<IAiIndexDocumentResponse> {
    return lastValueFrom(
      this.integrationsClient.send<IAiIndexDocumentResponse>(
        INTEGRATIONS_MESSAGE_PATTERNS.AI_INDEX_DOCUMENT,
        {
          fileBuffer: Array.from(fileBuffer),
          fileName,
          workspaceId,
        },
      ),
    );
  }

  async listDocuments(workspaceId: string): Promise<IAiDocumentSummary[]> {
    return lastValueFrom(
      this.integrationsClient.send<IAiDocumentSummary[]>(
        INTEGRATIONS_MESSAGE_PATTERNS.AI_LIST_DOCUMENTS,
        { workspaceId },
      ),
    );
  }

  async deleteDocument(workspaceId: string, documentName: string): Promise<{ success: boolean }> {
    return lastValueFrom(
      this.integrationsClient.send<{ success: boolean }>(
        INTEGRATIONS_MESSAGE_PATTERNS.AI_DELETE_DOCUMENT,
        { workspaceId, documentName },
      ),
    );
  }
}
