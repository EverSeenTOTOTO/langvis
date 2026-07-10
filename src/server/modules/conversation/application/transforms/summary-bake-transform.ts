import { singleton, inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type {
  ConversationContext,
  ConvPhase,
  ConvTransform,
} from '@/server/modules/conversation/domain/model/conv-transform';
import Logger from '@/server/utils/logger';
import { convTransform } from './registry';

const SUMMARY_PREFIX = '<summary>';

@singleton()
@convTransform
export class SummaryBakeTransform implements ConvTransform {
  readonly id = 'summary-bake';
  readonly phase: ConvPhase[] = ['turn-start', 'turn-end'];
  private readonly logger = Logger.child({ source: 'SummaryBakeTransform' });

  constructor(
    @inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
  ) {}

  async *apply(ctx: ConversationContext): AsyncGenerator<void> {
    const candidates = ctx.messages
      .toArray()
      .filter(
        m =>
          m.role === Role.ASSIST &&
          m.agentRunId &&
          !m.content.startsWith(SUMMARY_PREFIX),
      );
    if (candidates.length === 0) return;

    const runIds = [...new Set(candidates.map(m => m.agentRunId!))];
    const runs = await this.agentRunRepo.findByIds(runIds);
    const summaries = new Map<string, string>();
    for (const run of runs) {
      if (run.processSummary) summaries.set(run.id, run.processSummary);
    }
    if (summaries.size === 0) return;

    let baked = 0;
    ctx.messages = ctx.messages.map(msg => {
      if (
        msg.role !== Role.ASSIST ||
        !msg.agentRunId ||
        msg.content.startsWith(SUMMARY_PREFIX)
      ) {
        return msg;
      }
      const ps = summaries.get(msg.agentRunId);
      if (!ps) return msg;
      baked++;
      return { ...msg, content: `<summary>${ps}</summary>\n\n${msg.content}` };
    });

    if (baked > 0) {
      this.logger.debug(
        `baked ${baked} process summary(ies) into history (conv ${ctx.conversationId})`,
      );
    }
  }
}
