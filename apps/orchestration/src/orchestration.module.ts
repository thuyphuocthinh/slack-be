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
import { AgentRankingService } from './llm/agent-ranking.service';
import { SupervisorPromptBuilder } from './llm/supervisor-prompt.builder';
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
import { ChannelMemoryEntity } from './entity/channel-memory.entity';
import { SkillEntity } from './entity/skill.entity';
import { ChannelMemoryService } from './memory/channel-memory.service';
import { ChannelMemoryCleanupService } from './memory/channel-memory-cleanup.service';
import { MemoryManagerService } from './memory/memory-manager.service';
import { SkillService } from './memory/skill.service';
import { SkillRetrievalService } from './memory/skill-retrieval.service';
import { CheckpointService } from './checkpoint/checkpoint.service';
import { CheckpointCleanupService } from './checkpoint/checkpoint-cleanup.service';
import { TriggerClaimService } from './trigger-claim/trigger-claim.service';
import { CircuitBreakerService } from './common/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from './common/provider-concurrency-limiter.service';
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
import { MetricsRegistryService } from './common/metrics-registry.service';
import { HealthCheckService } from './common/health-check.service';
import { EdgeRelayRegistryService } from './edge-relay/edge-relay-registry.service';
import { EdgeRelayGateway } from './edge-relay/edge-relay.gateway';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      OrchestrationCheckpointEntity,
      OrchestrationTriggerClaimEntity,
      DynamicProviderEntity,
      ChannelMemoryEntity,
      SkillEntity,
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
    AgentRankingService,
    SupervisorPromptBuilder,
    MessageClientService,
    LlmStrategyFactory,
    GeminiStrategy,
    OpenAiStrategy,
    AnthropicStrategy,
    MockStrategy,
    AgentStreamService,
    CheckpointService,
    CheckpointCleanupService,
    ChannelMemoryService,
    ChannelMemoryCleanupService,
    MemoryManagerService,
    SkillService,
    SkillRetrievalService,
    TriggerClaimService,
    CircuitBreakerService,
    ProviderConcurrencyLimiterService,
    AgentCancellationService,
    TurnResolverService,
    CheckpointPauseService,
    ApprovalFlowService,
    MetricsRegistryService,
    HealthCheckService,
    EdgeRelayRegistryService,
    EdgeRelayGateway,
  ],
})
export class OrchestrationModule {}
