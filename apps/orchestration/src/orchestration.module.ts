import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigModule } from '@nestjs/config';
import { QueueModule, EQueueName } from '@slack/queue';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { OrchestrationController } from './orchestration.controller';
import { AiOrchestrationProcessor } from './processor/ai-orchestration.processor';
import { McpClientService } from './mcp/mcp-client.service';
import { McpAuthClientService } from './mcp-auth/mcp-auth-client.service';
import { GeminiReactService } from './llm/gemini-react.service';
import { MessageClientService } from './message-client.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.AI_ORCHESTRATION_QUEUE, EQueueName.SOCKET_QUEUE]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.MESSAGE_SERVICE, PORT_TCP.MESSAGE_TCP_PORT),
    ]),
  ],
  controllers: [OrchestrationController],
  providers: [
    AiOrchestrationProcessor,
    McpClientService,
    McpAuthClientService,
    GeminiReactService,
    MessageClientService,
  ],
})
export class OrchestrationModule {}
