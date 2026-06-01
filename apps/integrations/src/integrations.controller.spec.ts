import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsController', () => {
  let integrationsController: IntegrationsController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [IntegrationsService],
    }).compile();

    integrationsController = app.get<IntegrationsController>(IntegrationsController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(integrationsController.getHello()).toBe('Hello World!');
    });
  });
});
