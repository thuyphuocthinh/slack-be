import { Controller, Get } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

@Controller()
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  getHello(): string {
    return this.integrationsService.getHello();
  }
}
