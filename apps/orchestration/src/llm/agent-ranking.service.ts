import { Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { OpenAiEmbeddingProvider } from '../registry/openai-embedding.provider';
import { SemanticToolIndex } from '../common/agentic-openapi-parser';
import { AvailableAgentDto } from '../dto/supervisor.dto';

const MIN_AGENT_LABEL_LENGTH_FOR_RESCUE = 3;

// Tách khỏi SupervisorService — chỉ cần embeddingProvider, không đụng
// LLM/memory/skill. Trách nhiệm duy nhất: từ prompt + toàn bộ agent đã kết
// nối, quyết định agent nào liên quan (Tool RAG) và agent nào đang mơ hồ với
// nhau (ambiguous cluster).
@Injectable()
export class AgentRankingService {
  private readonly logger = new Logger(AgentRankingService.name);

  constructor(private readonly embeddingProvider: OpenAiEmbeddingProvider) {}

  async rankAgentsForPrompt(
    prompt: string,
    agents: AvailableAgentDto[],
  ): Promise<{ shown: AvailableAgentDto[]; omittedCount: number }> {
    if (agents.length <= ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING) {
      return { shown: agents, omittedCount: 0 };
    }

    try {
      const index = new SemanticToolIndex<AvailableAgentDto & { name: string }>(
        this.embeddingProvider,
      );
      await index.build(agents.map((a) => ({ ...a, name: a.label })));
      const clauses = this.splitPromptClauses(prompt);
      const rankedPerClause = await Promise.all(
        clauses.map((clause) =>
          index.search(clause, ORCHESTRATION_CONSTANTS.AGENT_RANKING_TOP_K),
        ),
      );
      const rankedByProvider = new Map<string, AvailableAgentDto>();
      for (const ranked of rankedPerClause) {
        for (const a of ranked) rankedByProvider.set(a.provider, a);
      }
      if (rankedByProvider.size === 0) {
        return { shown: agents, omittedCount: 0 };
      }
      const shown = this.rescueNamedAgents(prompt, agents, [
        ...rankedByProvider.values(),
      ]);
      return { shown, omittedCount: agents.length - shown.length };
    } catch (error) {
      this.logger.warn(
        `rankAgentsForPrompt() lỗi, fallback về liệt kê hết ${agents.length} agent: ${(error as Error).message}`,
      );
      return { shown: agents, omittedCount: 0 };
    }
  }

  findAmbiguousAgentCluster(
    prompt: string,
    agents: AvailableAgentDto[],
    chosenProvider: string,
  ): AvailableAgentDto[] | null {
    const chosen = agents.find((a) => a.provider === chosenProvider);
    if (!chosen) return null;

    const tokenize = (text: string) =>
      new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const chosenTokens = tokenize(chosen.description);
    const promptTokens = tokenize(prompt);
    const chosenLabelTokens = tokenize(chosen.label);

    const wordsMatch = (x: string, y: string) =>
      x === y || `${x}s` === y || `${y}s` === x;

    const similarOthers = agents.filter((a) => {
      if (a.provider === chosenProvider) return false;
      const otherTokens = tokenize(a.description);
      const intersectionSize = [...chosenTokens].filter((t) =>
        otherTokens.has(t),
      ).length;
      const unionSize = new Set([...chosenTokens, ...otherTokens]).size;
      const jaccard = unionSize === 0 ? 0 : intersectionSize / unionSize;
      if (jaccard < ORCHESTRATION_CONSTANTS.AMBIGUOUS_AGENT_JACCARD_THRESHOLD) {
        return false;
      }

      const otherLabelTokens = tokenize(a.label);
      const chosenOnlyWords = [...chosenLabelTokens].filter(
        (t) =>
          t.length >= MIN_AGENT_LABEL_LENGTH_FOR_RESCUE &&
          !otherLabelTokens.has(t),
      );
      const otherOnlyWords = [...otherLabelTokens].filter(
        (t) =>
          t.length >= MIN_AGENT_LABEL_LENGTH_FOR_RESCUE &&
          !chosenLabelTokens.has(t),
      );
      const namesWord = (words: string[]) =>
        words.some((w) => [...promptTokens].some((pt) => wordsMatch(pt, w)));
      if (namesWord(chosenOnlyWords) && !namesWord(otherOnlyWords)) {
        return false;
      }

      return true;
    });

    if (similarOthers.length === 0) return null;
    return [chosen, ...similarOthers];
  }

  private splitPromptClauses(prompt: string): string[] {
    const parts = prompt
      .split(/\brồi\b|\bsau đó\b|\bthen\b|\bafter that\b|;/gi)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const clauses = [...new Set([prompt, ...parts])];
    if (
      clauses.length > ORCHESTRATION_CONSTANTS.MAX_PROMPT_CLAUSES_FOR_RANKING
    ) {
      this.logger.warn(
        `splitPromptClauses() cắt ${clauses.length} mệnh đề còn ${ORCHESTRATION_CONSTANTS.MAX_PROMPT_CLAUSES_FOR_RANKING}`,
      );
      return clauses.slice(
        0,
        ORCHESTRATION_CONSTANTS.MAX_PROMPT_CLAUSES_FOR_RANKING,
      );
    }
    return clauses;
  }

  private rescueNamedAgents(
    prompt: string,
    agents: AvailableAgentDto[],
    shown: AvailableAgentDto[],
  ): AvailableAgentDto[] {
    const shownProviders = new Set(shown.map((a) => a.provider));
    const promptLower = prompt.toLowerCase();
    const rescued = agents.filter(
      (a) =>
        !shownProviders.has(a.provider) &&
        a.label.length >= MIN_AGENT_LABEL_LENGTH_FOR_RESCUE &&
        promptLower.includes(a.label.toLowerCase()),
    );
    if (rescued.length === 0) return shown;

    this.logger.log(
      `rescueNamedAgents() cứu ${rescued.length} agent bị ranking loại nhưng được nhắc rõ tên trong prompt gốc: ${rescued.map((a) => a.provider).join(',')}`,
    );
    return [...shown, ...rescued];
  }
}
