import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WebsocketExceptionsFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WebsocketExceptionsFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const client: Socket = host.switchToWs().getClient();

    // Determine error message and details
    const error =
      exception instanceof WsException ? exception.getError() : exception;

    const message =
      typeof error === 'string'
        ? error
        : (error as any)?.message || 'Internal server error';

    this.logger.error(`[WsException] ${message}`, exception);

    // Emit a specific 'exception' event back to the client
    client.emit('exception', {
      status: 'error',
      message: message,
      timestamp: new Date().toISOString(),
    });
  }
}
