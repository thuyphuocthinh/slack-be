import { Controller, Get, Post, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CanvasService } from './canvas.service';
import { CurrentUser, type JwtUser } from '@slack/common';

@ApiTags('Canvas')
@Controller('workspaces/:workspaceId/channels/:channelId/canvas')
@ApiBearerAuth()
export class CanvasController {
  constructor(private readonly canvasService: CanvasService) {}

  @Get()
  @ApiOperation({ summary: 'Get canvas metadata for a channel' })
  @ApiResponse({ status: 200, description: 'Canvas retrieved successfully' })
  async getCanvas(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.canvasService.getCanvasByChannel(channelId, user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Create canvas for a channel' })
  @ApiResponse({ status: 201, description: 'Canvas created successfully' })
  async createCanvas(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.canvasService.createCanvas(channelId, user.sub);
  }
}
