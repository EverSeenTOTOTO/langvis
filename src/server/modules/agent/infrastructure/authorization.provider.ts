import os from 'node:os';
import path from 'node:path';
import { injectable, container } from 'tsyringe';
import { ToolIds } from '@/shared/constants';
import type { RunEvent } from '@/shared/types/events';
import type { ToolCallContext } from '../domain/port/tool-call-context.port';
import AskUserTool from '../implementations/tools/AskUser';
import {
  AUTHORIZATION_PORT,
  type AuthAction,
  type AuthorizationPort,
  type EnsureApprovedOptions,
} from '../domain/port/authorization.port';

/**
 * 横切授权实现：per-run 缓存 (action, resource) 决策。
 * 命中缓存直接放行；未命中且 interactive → 弹一次 AskUser；非 interactive → 抛。
 * deny 不缓存（允许重试改主意）；allow 缓存到本 run。
 *
 * 生命周期：per-run 条目按 runId 累积；为防泄漏设 run 数上限（LRU 兜底）。
 * 真正的 per-run 清理可后续挂在 RunCompleted 事件，本实现先用上限兜底，
 * 避免引入事件订阅耦合——条目本身极小（一个 Set<string>）。
 */
const MAX_RUNS = 64;

@injectable()
export class AuthorizationProvider implements AuthorizationPort {
  private readonly grants = new Map<string, Set<string>>();

  async *ensureApproved(
    ctx: ToolCallContext,
    action: AuthAction,
    resource: string,
    opts: EnsureApprovedOptions,
  ): AsyncGenerator<RunEvent, void, void> {
    const key = `${action}:${resource}`;

    const granted = this.grants.get(ctx.runId);
    if (granted?.has(key)) return;

    if (!ctx.interactive) {
      throw new Error(
        `Authorization for ${action} on "${resource}" unavailable in non-interactive (sub-agent) run; cannot request user input`,
      );
    }

    const askUser = container.resolve<AskUserTool>(ToolIds.ASK_USER);
    const { submitted, data } = yield* askUser.call({
      ...ctx,
      input: { message: opts.prompt, formSchema: opts.formSchema as never },
    });

    if (!submitted || !(data as Record<string, unknown>)?.confirmed) {
      const remark = (data as Record<string, unknown>)?.remark;
      throw new Error(
        remark
          ? `用户拒绝授权 ${action} 于 "${resource}": ${remark}`
          : `用户拒绝授权 ${action} 于 "${resource}"`,
      );
    }

    this.touch(ctx.runId).add(key);
  }

  /** 取本 run 的授予集，顺带做 LRU 兜底：超 MAX_RUNS 删最旧。 */
  private touch(runId: string): Set<string> {
    const existing = this.grants.get(runId);
    if (existing) {
      this.grants.delete(runId);
      this.grants.set(runId, existing);
      return existing;
    }
    while (this.grants.size >= MAX_RUNS) {
      const oldest = this.grants.keys().next().value;
      if (oldest === undefined) break;
      this.grants.delete(oldest);
    }
    const fresh = new Set<string>();
    this.grants.set(runId, fresh);
    return fresh;
  }
}

/** 把任意绝对路径规范化为用户可直观判断的授权根目录。 */
export function normalizeRoot(absPath: string): string {
  const deglobbed = absPath.split(/[*?[\]{}]/)[0]!;
  const norm = path.normalize(deglobbed);
  const home = os.homedir();
  if (norm === home || norm === path.dirname(home)) return home;
  if (norm.startsWith(home + path.sep)) {
    return path.join(home, norm.slice(home.length + 1).split(path.sep)[0]!);
  }
  const parts = norm.split(path.sep).filter(Boolean);
  return `/${parts[0] ?? ''}`;
}

export function shortenHome(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export { AUTHORIZATION_PORT };
