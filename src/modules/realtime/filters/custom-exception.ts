import { ArgumentsHost, BadRequestException, Catch } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch(BadRequestException)
export class BadRequestExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    client.emit('exception', {
      status: 'error',
      code: exception.getStatus(), // return 400
      message: exception.message,
    });
  }
}
