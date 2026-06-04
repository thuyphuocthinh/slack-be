import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { AiService } from './ai.service';
import { AiChatDto, AiUploadDocumentDto, AiDeleteDocumentDto } from './dto/ai-chat.dto';
import { IAiChatResponse, IAiIndexDocumentResponse, IAiDocumentSummary } from './types/ai.type';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @Sse()
  @ApiOperation({ summary: 'Chat with AI (SSE Stream)' })
  @ApiResponse({ status: 201, description: 'Stream response' })
  chat(@Body() aiChatDto: AiChatDto): Observable<{ data: IAiChatResponse }> {
    return this.aiService.chat(aiChatDto).pipe(
      map((chunk) => ({ data: chunk })),
    );
  }

  @Post('documents')
  @ApiOperation({ summary: 'Upload and index a document for RAG' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Document indexed successfully' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AiUploadDocumentDto,
  ): Promise<IAiIndexDocumentResponse> {
    return this.aiService.indexDocument(file.buffer, file.originalname, dto.workspaceId);
  }

  @Get('documents')
  @ApiOperation({ summary: 'List indexed documents for a workspace' })
  @ApiResponse({ status: 200, description: 'List of documents' })
  async listDocuments(
    @Query('workspaceId') workspaceId: string,
  ): Promise<IAiDocumentSummary[]> {
    return this.aiService.listDocuments(workspaceId);
  }

  @Delete('documents')
  @ApiOperation({ summary: 'Delete an indexed document' })
  @ApiResponse({ status: 200, description: 'Document deleted' })
  async deleteDocument(
    @Body() dto: AiDeleteDocumentDto,
  ): Promise<{ success: boolean }> {
    return this.aiService.deleteDocument(dto.workspaceId, dto.documentName);
  }
}
