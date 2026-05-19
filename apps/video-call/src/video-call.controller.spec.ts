import { Test, TestingModule } from '@nestjs/testing';
import { VideoCallController } from './video-call.controller';
import { VideoCallService } from './video-call.service';

describe('VideoCallController', () => {
  let videoCallController: VideoCallController;

  const mockVideoCallService = {
    joinHuddle: jest.fn(),
    leaveHuddle: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [VideoCallController],
      providers: [
        {
          provide: VideoCallService,
          useValue: mockVideoCallService,
        },
      ],
    }).compile();

    videoCallController = app.get<VideoCallController>(VideoCallController);
  });

  it('should be defined', () => {
    expect(videoCallController).toBeDefined();
  });
});
