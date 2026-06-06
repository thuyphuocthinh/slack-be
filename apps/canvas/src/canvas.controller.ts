import { Controller, Get } from '@nestjs/common';
import { CanvasService } from './canvas.service';

@Controller()
export class CanvasController {
  constructor(private readonly canvasService: CanvasService) {}

  @Get()
  getHello(): string {
    return this.canvasService.getHello();
  }
}
