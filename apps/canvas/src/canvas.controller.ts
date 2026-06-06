import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CanvasService } from './canvas.service';
import { CANVAS_MESSAGE_PATTERN } from '@slack/constants';
import { GetCanvasByChannelDto, GetCanvasByIdDto } from './dto/get-canvas.dto';
import { CreateCanvasDto } from './dto/create-canvas.dto';

@Controller()
export class CanvasController {
  constructor(private readonly canvasService: CanvasService) {}

  @MessagePattern(CANVAS_MESSAGE_PATTERN.GET_CANVAS_BY_CHANNEL)
  async getCanvasByChannel(@Payload() dto: GetCanvasByChannelDto) {
    return this.canvasService.getCanvasByChannel(dto);
  }

  @MessagePattern(CANVAS_MESSAGE_PATTERN.GET_CANVAS)
  async getCanvasById(@Payload() dto: GetCanvasByIdDto) {
    return this.canvasService.getCanvasById(dto);
  }

  @MessagePattern(CANVAS_MESSAGE_PATTERN.CREATE_CANVAS)
  async createCanvas(@Payload() dto: CreateCanvasDto) {
    return this.canvasService.createCanvas(dto);
  }
}
