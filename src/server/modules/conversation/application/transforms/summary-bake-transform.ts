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
    const unbaked = ctx.messages
      .toArray()
      .filter(
        m =>
          m.role === Role.ASSIST &&
          m.agentRunId &&
          !ctx.bakedRunIds.has(m.agentRunId),
      );
    if (unbaked.length === 0) return;

    const runIds = [...new Set(unbaked.map(m => m.agentRunId!))];
    const runs = await this.agentRunRepo.findByIds(runIds);
    const summaries = new Map<string, string>();
    for (const run of runs) {
      if (run.processSummary) summaries.set(run.id, run.processSummary);
    }

    let baked = 0;
    ctx.messages = ctx.messages.map(msg => {
      if (
        msg.role !== Role.ASSIST ||
        !msg.agentRunId ||
        ctx.bakedRunIds.has(msg.agentRunId)
      ) {
        return msg;
      }
      ctx.bakedRunIds.add(msg.agentRunId);
      const ps = summaries.get(msg.agentRunId);
      if (!ps) return msg;
      baked++;
      return {
        ...msg,
        content: `<summary>${ps}</summary>\n\n${msg.content}`,
      };
    });

    if (baked > 0) {
      this.logger.debug(
        `baked ${baked} process summary(ies) into history (conv ${ctx.conversationId})`,
      );
    }
  }
}
