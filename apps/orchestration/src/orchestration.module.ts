import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@slack/database';
import { QueueModule, EQueueName } from '@slack/queue';
import { CachedModule } from '@slack/cached';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { OrchestrationController } from './orchestration.controller';
import { AiOrchestrationProcessor } from './processor/ai-orchestration.processor';
import { DynamicProviderProcessor } from './processor/dynamic-provider.processor';
import { McpClientService } from './mcp/mcp-client.service';
import { McpAuthClientService } from './mcp-auth/mcp-auth-client.service';
import { ReactLoopService } from './llm/react-loop.service';
import { SupervisorService } from './llm/supervisor.service';
import { MessageClientService } from './message-client.service';
import { LlmStrategyFactory } from './llm/strategy/llm-strategy.factory';
import { GeminiStrategy } from './llm/strategy/gemini.strategy';
import { OpenAiStrategy } from './llm/strategy/openai.strategy';
import { AnthropicStrategy } from './llm/strategy/anthropic.strategy';
import { MockStrategy } from './llm/strategy/mock.strategy';
import { AgentStreamService } from './socket/agent-stream.service';
import { OrchestrationCheckpointEntity } from './entity/orchestration-checkpoint.entity';
import { OrchestrationTriggerClaimEntity } from './entity/orchestration-trigger-claim.entity';
import { DynamicProviderEntity } from './entity/dynamic-provider.entity';
import { CheckpointService } from './checkpoint/checkpoint.service';
import { CheckpointCleanupService } from './checkpoint/checkpoint-cleanup.service';
import { TriggerClaimService } from './trigger-claim/trigger-claim.service';
import { CircuitBreakerService } from './common/circuit-breaker.service';
import { OpenApiParserService } from './parser/openapi-parser.service';
import { DynamicToolRegistryService } from './registry/dynamic-tool-registry.service';
import { DynamicProviderDbService } from './registry/dynamic-provider-db.service';
import { ProviderSummaryService } from './registry/provider-summary.service';
import { OpenAiEmbeddingProvider } from './registry/openai-embedding.provider';
import { DynamicToolExecutorService } from './executor/dynamic-tool-executor.service';
import { AgentCancellationService } from './cancellation/agent-cancellation.service';
import { TurnResolverService } from './processor/turn-resolver.service';
import { CheckpointPauseService } from './processor/checkpoint-pause.service';
import { ApprovalFlowService } from './processor/approval-flow.service';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      OrchestrationCheckpointEntity,
      OrchestrationTriggerClaimEntity,
      DynamicProviderEntity,
    ]),
    ScheduleModule.forRoot(),
    CachedModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.AI_ORCHESTRATION_QUEUE,
      EQueueName.SOCKET_QUEUE,
      EQueueName.DYNAMIC_PROVIDER_QUEUE,
    ]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(
        NAME_SERVICE_TCP.MESSAGE_SERVICE,
        PORT_TCP.MESSAGE_TCP_PORT,
      ),
    ]),
  ],
  controllers: [OrchestrationController],
  providers: [
    AiOrchestrationProcessor,
    DynamicProviderProcessor,
    McpClientService,
    McpAuthClientService,
    OpenApiParserService,
    DynamicToolRegistryService,
    DynamicProviderDbService,
    ProviderSummaryService,
    OpenAiEmbeddingProvider,
    DynamicToolExecutorService,
    ReactLoopService,
    SupervisorService,
    MessageClientService,
    LlmStrategyFactory,
    GeminiStrategy,
    OpenAiStrategy,
    AnthropicStrategy,
    MockStrategy,
    AgentStreamService,
    CheckpointService,
    CheckpointCleanupService,
    TriggerClaimService,
    CircuitBreakerService,
    AgentCancellationService,
    TurnResolverService,
    CheckpointPauseService,
    ApprovalFlowService,
  ],
})
export class OrchestrationModule {}
