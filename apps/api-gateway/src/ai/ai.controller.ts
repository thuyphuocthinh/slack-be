import { Body, Controller, Post, Sse } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/ai-chat.dto';
import { IAiChatResponse } from './types/ai.type';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Post('chat')
  @Sse()
  @ApiOperation({ summary: 'Chat with AI (SSE Stream)' })
  @ApiResponse({ status: 201, description: 'Stream response' })
  chat(@Body() aiChatDto: AiChatDto): Observable<{ data: IAiChatResponse }> {
    return this.aiService.chat(aiChatDto).pipe(
      map((chunk) => ({ data: chunk }))
    );
  }
}
