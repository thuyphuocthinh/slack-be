import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '@slack/common';
import { MessageService } from './message.service';
import { GetFullThreadQueryApiDto, GetThreadQueryApiDto } from './dto/message-api.dto';
import { GetFullThreadRequestDto, GetThreadRequestDto } from './dto/message-request.dto';

@ApiTags('Threads')
@Controller('workspaces/:workspaceId/threads')
@ApiBearerAuth()
export class ThreadController {
  constructor(private readonly messageService: MessageService) { }

  @Get()
  @ApiOperation({ summary: 'Get user threads' })
  async getThreads(
    @Param('workspaceId') workspaceId: string,
    @Query() query: GetThreadQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getThreads({
      ...query,
      userId: user.sub,
      workspaceId
    });
  }

  @Get(':threadId')
  @ApiOperation({ summary: 'Get full thread' })
  async getFullThread(
    @Param('threadId') threadId: string,
    @Query() query: GetFullThreadQueryApiDto,
  ) {
    return await this.messageService.getFullThread({
      ...query,
      threadId,
    } as GetFullThreadRequestDto);
  }
}
