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

/** 把上一轮 processSummary attach 为 msg.summary（透传至 agent 种子作 thought）。 */
@singleton()
@convTransform
export class SummaryAttachTransform implements ConvTransform {
  readonly id = 'summary-attach';
  readonly phase: ConvPhase[] = ['turn-start'];
  private readonly logger = Logger.child({ source: 'SummaryAttachTransform' });

  constructor(
    @inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
  ) {}

  async *apply(ctx: ConversationContext): AsyncGenerator<void> {
    const candidates = ctx.messages
      .toArray()
      .filter(m => m.role === Role.ASSIST && m.agentRunId && !m.summary);
    if (candidates.length === 0) return;

    const runIds = [...new Set(candidates.map(m => m.agentRunId!))];
    const runs = await this.agentRunRepo.findByIds(runIds);
    const summaries = new Map<string, string>();
    for (const run of runs) {
      if (run.processSummary) summaries.set(run.id, run.processSummary);
    }
    if (summaries.size === 0) return;

    let attached = 0;
    ctx.messages = ctx.messages.map(msg => {
      if (msg.role !== Role.ASSIST || !msg.agentRunId || msg.summary) {
        return msg;
      }
      const ps = summaries.get(msg.agentRunId);
      if (!ps) return msg;
      attached++;
      return { ...msg, summary: ps };
    });

    if (attached > 0) {
      this.logger.debug(
        `attached ${attached} process summary(ies) as data (conv ${ctx.conversationId})`,
      );
    }
  }
}
