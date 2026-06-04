import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { AiService } from './ai.service';
import { DocumentService } from './document.service';
import { INTEGRATIONS_MESSAGE_PATTERNS } from '@slack/constants';
import type {
  IAiChatRequest,
  IAiChatResponse,
  IAiIndexDocumentRequest,
  IAiIndexDocumentResponse,
  IAiListDocumentsRequest,
  IAiDocumentSummary,
  IAiDeleteDocumentRequest,
} from './types/ai.type';

@Controller()
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly documentService: DocumentService,
  ) { }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.AI_CHAT)
  handleAiChat(@Payload() data: IAiChatRequest): Observable<IAiChatResponse> {
    return this.aiService.generateResponse(data);
  }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.AI_INDEX_DOCUMENT)
  async handleIndexDocument(
    @Payload() data: IAiIndexDocumentRequest,
  ): Promise<IAiIndexDocumentResponse> {
    const fileBuffer = Buffer.from(data.fileBuffer);
    return this.documentService.indexDocument(fileBuffer, data.fileName, data.workspaceId);
  }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.AI_LIST_DOCUMENTS)
  async handleListDocuments(
    @Payload() data: IAiListDocumentsRequest,
  ): Promise<IAiDocumentSummary[]> {
    return this.documentService.listDocuments(data.workspaceId);
  }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.AI_DELETE_DOCUMENT)
  async handleDeleteDocument(
    @Payload() data: IAiDeleteDocumentRequest,
  ): Promise<{ success: boolean }> {
    await this.documentService.deleteDocument(data.workspaceId, data.documentName);
    return { success: true };
  }
}
