import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@slack/common';
import { OrchestrationService } from './orchestration.service';
import { EdgeLoginDto } from './dto/edge-login.dto';
import { RateLimit } from '../common/guards/rate-limit.decorator';

@Controller('edge-relay/auth')
@ApiTags('Orchestration')
export class OrchestrationController {
  constructor(private readonly orchestrationService: OrchestrationService) {}

  @ApiOperation({ summary: 'Edge relay login' })
  @ApiResponse({ status: 200, description: 'Edge relay token issued' })
  @Public()
  @RateLimit({ limit: 5, window: 60 })
  @Post('token')
  async login(@Body() dto: EdgeLoginDto) {
    return await this.orchestrationService.edgeLogin(dto);
  }
}
