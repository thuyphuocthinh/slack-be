import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CANVAS_MESSAGE_PATTERN, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';

@Injectable()
export class CanvasService {
  private readonly logger = new Logger(CanvasService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.CANVAS_SERVICE)
    private readonly canvasClient: ClientProxy,
  ) { }

  async getCanvasByChannel(channelId: string, memberId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.canvasClient.send(CANVAS_MESSAGE_PATTERN.GET_CANVAS_BY_CHANNEL, {
            channelId,
            userId: memberId,
          }),
        ),
      'getCanvasByChannel',
      'CanvasService',
    );
  }

  async createCanvas(channelId: string, memberId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.canvasClient.send(CANVAS_MESSAGE_PATTERN.CREATE_CANVAS, {
            channelId,
            userId: memberId,
          }),
        ),
      'createCanvas',
      'CanvasService',
    );
  }
}
