import { Injectable } from '@nestjs/common';

@Injectable()
export class MessageService {
  getHello(): string {
    return 'Hello World!';
  }
}

// save message
// update message
// delete message
// pin message
// unpin message
// reply message
// edit message
// threads
// search messages
// toggle reaction
// get message by id
