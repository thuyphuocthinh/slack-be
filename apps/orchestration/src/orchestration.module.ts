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
import { ReactLoopService } from './llm/react-loop.service';
import { SupervisorService } from './llm/supervisor.service';
import { MessageClientService } from './message-client.service';
import { LlmStrategyFactory } from './llm/strategy/llm-strategy.factory';
import { GeminiStrategy } from './llm/strategy/gemini.strategy';
import { OpenAiStrategy } from './llm/strategy/openai.strategy';
import { AnthropicStrategy } from './llm/strategy/anthropic.strategy';
import { AgentStreamService } from './socket/agent-stream.service';

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
    ReactLoopService,
    SupervisorService,
    MessageClientService,
    LlmStrategyFactory,
    GeminiStrategy,
    OpenAiStrategy,
    AnthropicStrategy,
    AgentStreamService,
  ],
})
export class OrchestrationModule {}
