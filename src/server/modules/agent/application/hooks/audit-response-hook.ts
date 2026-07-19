import { inject } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';
import type { LlmMessage } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { ToolIds } from '@/shared/constants';
import { parseResponse } from '@/server/modules/agent/application/service/react-loop';
import { AgentRunExecutor } from '@/server/modules/agent/application/service/agent-run-executor';
import type { LaunchParams } from '@/server/modules/agent/application/service/agent-run-executor';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';
import { AUDIT_PROMPT } from '@/server/modules/agent/application/service/base-prompt';
import type { AuditConfig } from '@/server/libs/config/fragments/audit';
import type { ConversationConfig } from '@/server/libs/config';
import { generateId } from '@/shared/utils';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

const OBSERVATION_PREFIX = 'Observation: ';
const DEFAULT_MAX_REJECTIONS = 2;

type VerdictKind = 'verified' | 'refuted' | 'unable';
interface Verdict {
  verdict: VerdictKind;
  evidence?: string;
}

/**
 * post-LLM 答复审计：agent 调 response_user 时，另起一个独立上下文的审计子 run
 * （AgentRunExecutor.launch，只读 verifier toolset，剥 audit fragment 防递归），
 * 自己复算校验答复是否站得住。三态：verified/unable→放行；refuted-w-evidence→
 * 追加 Observation 让主 agent 重跑 + 'continue'。per-run 否决计数兜底防无限循环。
 *
 * 独立上下文：审计子 run 只见 goal+reply，看不到主 agent 推理史，故不被其带偏；
 * 审计自身也可能幻觉，故默认 abstain-not-veto（无正证据不否决），仅 refuted-with-evidence 否决。
 */
@agentHook
export class AuditResponseHook implements Hook {
  readonly id = 'audit-response';
  readonly phase: HookPhase = 'post-llm';
  private readonly logger = Logger.child({ source: 'AuditResponseHook' });
  private rejections = 0;

  constructor(
    @inject(AgentRunExecutor) private readonly executor: AgentRunExecutor,
    @inject(AgentService) private readonly agentService: AgentService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const cfg = ctx.config.runtimeConfig.audit as AuditConfig | undefined;
    if (!cfg?.enabled) return 'next';

    const last = ctx.messages.get(ctx.messages.length - 1);
    if (!last || last.role !== 'assistant') return 'next';

    let parsed: ReturnType<typeof parseResponse>;
    try {
      parsed = parseResponse(last.content);
    } catch {
      return 'next';
    }
    if (parsed.tool !== ToolIds.RESPONSE_USER) return 'next';

    const reply = String((parsed.input as { message?: unknown }).message ?? '');
    const goal = extractGoal(ctx.messages.toArray());
    if (!reply || !goal) return 'next';

    const verdict = await this.runAudit(ctx, goal, reply);

    yield {
      type: 'hook',
      hookId: this.id,
      summary: `audit verdict: ${verdict.verdict}`,
      data: { verdict: verdict.verdict, evidence: verdict.evidence },
    };

    if (verdict.verdict !== 'refuted') return 'next';

    const max = cfg.maxRejections ?? DEFAULT_MAX_REJECTIONS;
    if (this.rejections >= max) {
      this.logger.warn(
        `audit refuted but cap reached (run ${ctx.runId}): rejections=${this.rejections}/${max}; force-allow`,
      );
      return 'next';
    }
    this.rejections++;

    const obs = buildRejectionObservation(this.rejections, verdict.evidence);
    ctx.messages = ctx.messages.append({
      role: Role.USER,
      content: `${OBSERVATION_PREFIX}${obs}`,
    });
    this.logger.info(
      `audit refuted (run ${ctx.runId}): rejections=${this.rejections}/${max}; sending back to redo`,
    );
    return 'continue';
  }

  /**
   * 独立审计子 run：复用 launch 接缝，只读 verifier toolset（bash + cached_read + response_user），
   * 剥 audit fragment 防递归。子事件不外泄到父 run。
   * executor/agentService 走正常 @inject（同 OffloadHook 注 ProviderService）：因 agent-run-executor
   * 已从 hooks/registry（非 barrel）取 resolveAgentHooks，故 executor 不再静态 import hooks barrel，
   * audit-hook → executor 这条边不构成循环——无需动态 import / 手动 resolve。
   */
  private async runAudit(
    ctx: AgentRunContext,
    goal: string,
    reply: string,
  ): Promise<Verdict> {
    // 只读 verifier toolset：bash（cat/rg/grep/ls）+ cached_read（大输出分页回读）+ response_user。
    // 不给 call_subagents（不嵌套）/ ask_user（审计无人类介入）/ 写动作工具——审计只复算不改。
    const childToolSet = ToolSet.of(
      [
        { id: ToolIds.BASH, mode: 'inline' as const },
        { id: ToolIds.CACHED_READ, mode: 'inline' as const },
        { id: ToolIds.RESPONSE_USER, mode: 'inline' as const },
      ],
      [],
    );
    const systemPrompt = this.agentService.buildSystemPrompt(
      childToolSet,
      AUDIT_PROMPT,
    );
    // 剥 audit fragment：审计不再审计自己（防递归）。auditModelId 兜底对话主模型。
    const { audit: auditCfg, ...rest } = ctx.config.runtimeConfig;
    const auditModelId = (auditCfg as AuditConfig | undefined)?.auditModelId;
    const childRuntime = {
      ...rest,
      model: {
        ...rest.model,
        modelId: auditModelId ?? rest.model?.modelId,
      },
    } as ConversationConfig;

    const params: LaunchParams = {
      runId: generateId('run'),
      workDir: ctx.workDir,
      runtimeConfig: childRuntime,
      seed: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            `## Task goal\n${goal}\n\n## Agent's reply\n${reply}\n\n` +
            `Verify whether the reply is actually grounded in the real environment. ` +
            `Re-run the relevant read-only checks yourself and compare. Then deliver your verdict via response_user.`,
        },
      ],
      toolSet: childToolSet,
      interactive: false,
      parentSignal: ctx.signal,
    };

    let verdictMessage = '';
    let ranCheck = false;
    // 审计子 run 的实际 tool_result 输出——RESULT 须在此重定位，不信 LLM 自述。
    // 9B 会把 reply 当 tool 输出回读 / confabulate 证据，须拿事件流原文复核。
    const toolOutputs: string[] = [];
    try {
      for await (const event of this.executor.launch(
        params,
      ) as AsyncIterable<EnrichedEvent>) {
        if (event.type === 'tool_call') {
          // ranCheck：是否真跑过校验工具（非 response_user）。确定性信号 gate LLM verdict。
          if (event.toolName !== ToolIds.RESPONSE_USER) {
            ranCheck = true;
          } else {
            verdictMessage = String(
              (event.toolArgs as { message?: unknown }).message ?? '',
            );
          }
        } else if (event.type === 'tool_result') {
          const out = event.output;
          toolOutputs.push(typeof out === 'string' ? out : JSON.stringify(out));
        }
      }
    } catch (err) {
      this.logger.warn(
        `audit sub-run failed (run ${ctx.runId}): ${(err as Error)?.message ?? err}`,
      );
      return { verdict: 'unable' };
    }

    if (!ranCheck) {
      this.logger.warn(
        `audit ran no verification tool (run ${ctx.runId}); abstaining — verdict not trusted`,
      );
      return { verdict: 'unable' };
    }
    return deriveVerdict(verdictMessage, toolOutputs);
  }
}

/** 构造追加给主 agent 的 Observation，措辞随否决次数递增而严厉（防反复编造）。 */
function buildRejectionObservation(
  rejection: number,
  evidence?: string,
): string {
  const evidenceLine = evidence ? `\nEvidence: ${evidence}` : '';
  const lead =
    rejection <= 1
      ? `An independent auditor found concrete evidence your reply is not grounded in the real environment.`
      : `This is your ${ordinal(rejection)} ungrounded reply — the auditor refuted your previous answer(s) too. ` +
        `Stop producing plausible-sounding answers without actually running the tools.`;
  const demand =
    rejection <= 1
      ? `Re-do the task: actually run the required commands/tools to obtain the real result and report it via response_user. Do not restate an unverified answer.`
      : `You MUST execute the real commands now, read the actual output, and report only what the real environment returns. Any further answer that skips the tools will be rejected again.`;
  return `[audit] ${lead}${evidenceLine}\n${demand}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? 'th');
}

/** 最近一条非 Observation 的 user 消息 = 当前要回答的 task goal（审计只见这个）。 */
function extractGoal(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    if (m.content.startsWith(OBSERVATION_PREFIX)) continue;
    return m.content;
  }
  return '';
}

/**
 * 从审计子 run 的 response_user 文本 + 实际 tool_result 输出，重定位出可验的矛盾证据。
 *
 * 协议（plain text，非 JSON——小模型转义差）：
 *   `UNKNOWN`                          → abstain（grounded / inconclusive / 无可核证据）
 *   `RESULT: <某条 tool 输出原样子串>`   → 仅当 RESULT 真与 reply 矛盾时才发
 *
 * sound-gate（只门控 RESULT）：RESULT 须能在某条实际 tool_result 输出重定位——防审计
 * confabulate 证据（9B 会把 reply 当 tool 输出回读 / 把空结果总结成"工作目录为空"的散文，
 * 后者自然过不了重定位 → abstain）。CLAIM 不门控：reply 是 harness 已知的，审计点错 claim
 * 至多误判（单向安全残余）；而 RESULT 必须真——这才是反幻觉契约里"veto 需正证据"的机械实现，
 * 也避开要求小模型逐字复述 claim（它会改述 → 真 veto 被误杀）。
 *
 * 残余 unsoundness：审计把一个 real observation 误判为与 reply 矛盾（misjudgment）仍会
 * 假 veto——但比旧"扫 refuted 关键词"窄得多：证据是真的，编不出来了。
 */
export function deriveVerdict(
  message: string,
  toolOutputs: readonly string[],
): Verdict {
  const msg = message.trim();
  if (!msg) return { verdict: 'unable' };
  const resultIdx = msg.indexOf('RESULT:');
  if (resultIdx === -1) return { verdict: 'unable' };
  const result = msg.slice(resultIdx + 'RESULT:'.length).trim();
  if (!result) return { verdict: 'unable' };
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const grounded = toolOutputs.some(o => norm(o).includes(norm(result)));
  if (!grounded) return { verdict: 'unable' };
  return { verdict: 'refuted', evidence: result };
}
