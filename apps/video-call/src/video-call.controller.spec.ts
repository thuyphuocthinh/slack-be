import { Test, TestingModule } from '@nestjs/testing';
import { VideoCallController } from './video-call.controller';
import { VideoCallService } from './video-call.service';

describe('VideoCallController', () => {
  let videoCallController: VideoCallController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [VideoCallController],
      providers: [VideoCallService],
    }).compile();

    videoCallController = app.get<VideoCallController>(VideoCallController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(videoCallController.getHello()).toBe('Hello World!');
    });
  });
});
