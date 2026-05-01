import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '@slack/common';
import { MessageService } from './message.service';
import { GetThreadQueryApiDto } from './dto/message-api.dto';
import { GetThreadRequestDto } from './dto/message-request.dto';

@ApiTags('Threads')
@Controller('threads')
@ApiBearerAuth()
export class ThreadController {
  constructor(private readonly messageService: MessageService) {}

  @Get()
  @ApiOperation({ summary: 'Get user threads' })
  async getThreads(
    @Query() query: GetThreadQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getThreads({
      ...query,
      userId: user.sub,
    } as GetThreadRequestDto);
  }
}
