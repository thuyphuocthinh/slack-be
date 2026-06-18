import { Test, TestingModule } from '@nestjs/testing';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

describe('CalendarController', () => {
  let calendarController: CalendarController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [CalendarService],
    }).compile();

    calendarController = app.get<CalendarController>(CalendarController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(calendarController.getHello()).toBe('Hello World!');
    });
  });
});
