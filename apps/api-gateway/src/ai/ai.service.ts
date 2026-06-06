import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  INTEGRATIONS_MESSAGE_PATTERNS,
  NAME_SERVICE_TCP,
} from '@slack/constants';
import {
  IAiChatRequest,
  IAiChatResponse,
  IAiIndexDocumentResponse,
  IAiDocumentSummary,
} from './types/ai.type';
import { Observable, lastValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
@Injectable()
export class AiService {
  constructor(
    @Inject(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE)
    private readonly integrationsClient: ClientProxy,
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
    let fileContent = '';
    const lowerName = fileName.toLowerCase();

    try {
      if (lowerName.endsWith('.pdf')) {
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(fileBuffer);
        fileContent = pdfData.text;
      } else if (lowerName.endsWith('.docx')) {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        fileContent = result.value;
      } else {
        // default to text
        fileContent = fileBuffer.toString('utf-8');
      }
    } catch (e) {
      throw new Error(`Failed to parse file ${fileName}: ${e.message}`);
    }

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.integrationsClient.send<IAiIndexDocumentResponse>(
            INTEGRATIONS_MESSAGE_PATTERNS.AI_INDEX_DOCUMENT,
            {
              fileContent,
              fileName,
              workspaceId,
            },
          ),
        ),
      'indexDocument',
      'AiService',
    );
  }

  async listDocuments(workspaceId: string): Promise<IAiDocumentSummary[]> {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.integrationsClient.send<IAiDocumentSummary[]>(
            INTEGRATIONS_MESSAGE_PATTERNS.AI_LIST_DOCUMENTS,
            { workspaceId },
          ),
        ),
      'listDocuments',
      'AiService',
    );
  }

  async deleteDocument(
    workspaceId: string,
    documentName: string,
  ): Promise<{ success: boolean }> {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.integrationsClient.send<{ success: boolean }>(
            INTEGRATIONS_MESSAGE_PATTERNS.AI_DELETE_DOCUMENT,
            { workspaceId, documentName },
          ),
        ),
      'deleteDocument',
      'AiService',
    );
  }
}
