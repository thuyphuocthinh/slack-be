import { Logger } from '@nestjs/common';
import { RunReactLoopRequestDto } from '../dto/react-loop.dto';
import { McpToolDto } from '../dto/mcp.dto';
import { LlmStrategy } from './strategy/llm-strategy.interface';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { extractRequiredCount } from './quantity-check.util';
import { isLikelyCreateToolCall } from '../memory/create-tool-heuristic.util';
import { AGENT_REGISTRY } from '../registry/agents.registry';
import { extractWriteQueryPreviewTarget } from './write-query-preview.util';
import { InsertAccumulator } from './insert-accumulator';

export interface ToolRiskGateOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  strategy: LlmStrategy;
  model: string;
  circuitBreaker: CircuitBreakerService;
  logger: Logger;
  signal: AbortSignal;
  insertAccumulator: InsertAccumulator;
}

/**
 * Quyết định risk-gate (destructive? auto-approve INSERT? thiếu dòng so với
 * yêu cầu?) — tách khỏi ReactLoopRun để test được trực tiếp thay vì chỉ suy
 * ra qua số lần gọi mock. KHÔNG tự thực thi tool, chỉ trả quyết định — caller
 * (ToolCallExecutor) mới là nơi chạy tool/ghi trace.
 */
export class ToolRiskGate {
  private readonly dto: RunReactLoopRequestDto;
  private readonly mcpTools: McpToolDto[];
  private readonly strategy: LlmStrategy;
  private readonly model: string;
  private readonly circuitBreaker: CircuitBreakerService;
  private readonly logger: Logger;
  private readonly signal: AbortSignal;
  private readonly insertAccumulator: InsertAccumulator;

  // Lazy + memoized — chỉ tốn 1 LLM call DUY NHẤT cho cả lượt chạy, và chỉ
  // khi thật sự cần (tool ghi dạng create bị chặn approval), không tốn cho
  // các round chỉ đọc dữ liệu.
  private requiredCountPromise: Promise<number> | null = null;

  constructor(options: ToolRiskGateOptions) {
    this.dto = options.dto;
    this.mcpTools = options.mcpTools;
    this.strategy = options.strategy;
    this.model = options.model;
    this.circuitBreaker = options.circuitBreaker;
    this.logger = options.logger;
    this.signal = options.signal;
    this.insertAccumulator = options.insertAccumulator;
  }

  isDestructive(name: string): boolean {
    return Boolean(
      this.mcpTools.find((t) => t.name === name)?.annotations?.destructiveHint,
    );
  }

  // INSERT không đụng tới dữ liệu CŨ — sai thì chỉ cần xoá dòng vừa thêm,
  // khác hẳn UPDATE/DELETE (có thể ghi đè/xoá mất dữ liệu không khôi phục
  // được). Chỉ tự chạy đúng trường hợp này, mọi câu lệnh ghi khác vẫn qua
  // Risk Gate như cũ.
  isAutoApprovableInsert(name: string, args: Record<string, unknown>): boolean {
    if (
      this.dto.provider !== 'sql_server' ||
      name !== 'execute_write_query' ||
      AGENT_REGISTRY[this.dto.provider]?.perWorkspaceInstance
    ) {
      return false;
    }
    const query = typeof args.query === 'string' ? args.query : undefined;
    if (!query) return false;
    return extractWriteQueryPreviewTarget(query)?.kind === 'insert-rows';
  }

  // Model ghi thiếu dòng so với yêu cầu, kể cả rải ra nhiều lần gọi 1-dòng-1-lần —
  // gộp tuple tích luỹ được thành 1 câu INSERT duy nhất, ghi đè args.query.
  async checkBulkInsertShortfall(
    displayName: string,
    argsPreview: string,
    args: Record<string, unknown>,
  ): Promise<string | null> {
    const query = typeof args.query === 'string' ? args.query : undefined;
    if (!query || !isLikelyCreateToolCall({ tool: displayName, argsPreview })) {
      return null;
    }
    const requiredCount = await this.getRequiredCount();
    if (requiredCount <= 0) return null;

    const outcome = this.insertAccumulator.checkShortfall(query, requiredCount);
    if (!outcome) return null;
    if ('mergedQuery' in outcome) {
      args.query = outcome.mergedQuery;
      return null;
    }
    return outcome.shortfallMessage;
  }

  clearAccumulatorFor(query: string): void {
    this.insertAccumulator.clear(query);
  }

  private getRequiredCount(): Promise<number> {
    if (!this.requiredCountPromise) {
      this.requiredCountPromise = extractRequiredCount(
        this.dto.prompt,
        this.strategy,
        this.model,
        this.circuitBreaker,
        this.logger,
        this.signal,
      );
    }
    return this.requiredCountPromise;
  }
}
