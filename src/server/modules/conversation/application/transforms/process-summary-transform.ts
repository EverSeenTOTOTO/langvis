import { inject } from 'tsyringe';
import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type {
  ConversationContext,
  ConvPhase,
  ConvTransform,
  RunCtx,
} from '@/server/modules/conversation/domain/model/conv-transform';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { ToolIds } from '@/shared/constants';
import Logger from '@/server/utils/logger';
import { convTransform } from './registry';

// turn-end 把本 run 的工具调用轨迹拼成确定性过程摘要，写入 assistant 消息 meta.summary，
// 供下轮透传为 seed thought。不调模型：每个工具经自身 describe 自述，未实现则走通用模板回退。
@convTransform
export class ProcessSummaryTransform implements ConvTransform {
  readonly id = 'process-summary';
  readonly phase: ConvPhase = 'turn-end';
  private readonly logger = Logger.child({ source: 'ProcessSummaryTransform' });

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: MessageRepositoryPort,
    @inject(ToolService)
    private readonly toolService: ToolService,
  ) {}

  async *apply(
    ctx: ConversationContext,
    runCtx?: RunCtx,
  ): AsyncGenerator<StreamFrame | void> {
    if (!runCtx) return;
    const compaction = ctx.runtimeConfig.loop;
    if (!compaction) return;

    const events = ctx.getRunEvents(runCtx.messageId);
    if (!events || events.length === 0) return;

    const calls = events.filter(e => e.type === 'tool_call');
    if (calls.length <= 1) {
      this.logger.debug(`trivial turn, skipped (msg ${runCtx.messageId})`);
      return;
    }

    const summary = buildProcessSummary(events, id =>
      this.toolService.resolve(id),
    );
    if (!summary) return;

    const existing = await this.fetchMeta(ctx, runCtx.messageId);
    await this.messageRepo.update(runCtx.messageId, {
      meta: { ...existing, summary },
    });
    this.logger.info(
      `built deterministic process summary (msg ${runCtx.messageId}): ${calls.length} tool calls`,
    );
  }

  /** 取该消息现有 meta（合并写、不覆盖既有键）；消息不存在则空对象。 */
  private async fetchMeta(
    ctx: ConversationContext,
    messageId: string,
  ): Promise<Record<string, unknown>> {
    const msg = ctx.messages.find(m => m.id === messageId);
    return { ...(msg?.meta ?? {}) };
  }
}

// 把 run 事件流按 callId 配对 tool_call 与 tool_result/tool_error，逐工具确定性叙述为编号列表。
// 有 describe 的工具自述；否则走通用模板（toolName(args) → 结果/Error）。
export function buildProcessSummary(
  events: readonly EnrichedEvent[],
  resolveTool: (id: string) => Tool | undefined,
): string | null {
  const outcomes = new Map<
    string,
    {
      toolName: string;
      args: Record<string, unknown>;
      output?: unknown;
      error?: string;
    }
  >();

  for (const e of events) {
    switch (e.type) {
      case 'tool_call':
        outcomes.set(e.callId, {
          toolName: e.toolName,
          args: e.toolArgs ?? {},
        });
        break;
      case 'tool_result': {
        const rec = outcomes.get(e.callId);
        if (rec) rec.output = e.output;
        break;
      }
      case 'tool_error': {
        const rec = outcomes.get(e.callId);
        if (rec) rec.error = e.error;
        break;
      }
      default:
        break;
    }
  }

  const lines: string[] = [];
  for (const { toolName, args, output, error } of outcomes.values()) {
    // 终端交付工具（response_user）的 message 即最终答复，已入消息正文，不写入过程摘要。
    if (toolName === ToolIds.RESPONSE_USER) continue;

    const tool = resolveTool(toolName);
    const narration =
      tool?.describe?.(args, output, error) ??
      genericNarration(toolName, args, output, error);
    lines.push(narration);
  }
  if (lines.length === 0) return null;

  return lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

function genericNarration(
  toolName: string,
  args: Record<string, unknown>,
  output?: unknown,
  error?: string,
): string {
  if (error) {
    return `${toolName}(${formatArgs(args)}) → Error: ${error}`;
  }
  return `${toolName}(${formatArgs(args)}) → ${summarizeOutput(output)}`;
}

function formatArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  return keys.map(k => `${k}=${summarizeValue(args[k])}`).join(', ');
}

function summarizeOutput(output: unknown): string {
  if (output === undefined || output === null) return 'ok';
  const s = JSON.stringify(output);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

function summarizeValue(v: unknown): string {
  if (typeof v === 'string') {
    return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  }
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
