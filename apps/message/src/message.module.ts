import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './service/message.service';
import { DatabaseModule } from '@slack/database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageEntity } from './entity/message.entity';
import { MessageMentionEntity } from './entity/message_mention.entity';
import { MessageReactionEntity } from './entity/message_reaction.entity';
import { CachedModule } from '@slack/cached';

@Module({
  imports: [
    DatabaseModule,
    CachedModule.forRoot(),
    TypeOrmModule.forFeature([
      MessageEntity,
      MessageMentionEntity,
      MessageReactionEntity,
    ]),
  ],
  controllers: [MessageController],
  providers: [MessageService],
})
export class MessageModule {}
