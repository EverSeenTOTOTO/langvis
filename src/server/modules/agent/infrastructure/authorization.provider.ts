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

/**
 * 授权根 = 用户直观判断的目录：
 * - 单文件 → 直接父目录：~/a/b/c.pdf → ~/a/b；/etc/foo.pdf → /etc。
 * - glob → 通配符前的稳定前缀目录（即 glob 锚定的那层）：~/a/b/*.pdf → ~/a/b。
 * 两者统一用 dirname：单文件 dirname 取父目录；glob 前缀形如 "…/b/" 的 dirname 正是 "…/b"。
 * 最窄粒度，避免授权到含敏感子目录的大范围。
 */
/**
 * 授权根 = 用户直观判断的目录：
 * - 单文件（无通配符）→ 直接父目录：~/a/b/c.pdf → ~/a/b；/etc/foo.pdf → /etc。
 * - glob（含通配符）→ 通配符前的稳定前缀目录（即 glob 锚定的那层）：~/a/b/*.pdf → ~/a/b。
 *   单文件与 glob 必须分开：Node 的 path.dirname 不认尾部斜杠，对 glob 前缀 "…/b/" 会错剥一层。
 * 最窄粒度，避免授权到含敏感子目录的大范围。
 */
export function normalizeRoot(absPath: string): string {
  const home = os.homedir();
  if (absPath === home || absPath === path.dirname(home)) return home;

  if (/[*?[\]{}]/.test(absPath)) {
    // glob：稳定前缀去尾部分隔符即目标目录（"/a/b/" → "/a/b"；根 "/" 保持）。
    const prefix = absPath.split(/[*?[\]{}]/)[0]!;
    const stripped = path.normalize(prefix).replace(/\/+$/, '');
    return stripped === '' ? path.sep : stripped;
  }

  // 单文件：取父目录；dirname 在根目录自环（/etc → /etc）时退到自身。
  const norm = path.normalize(absPath);
  const dir = path.dirname(norm);
  return dir === norm ? norm : dir;
}

export function shortenHome(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export { AUTHORIZATION_PORT };
