import os from 'node:os';
import path from 'node:path';
import { injectable, inject, container } from 'tsyringe';
import { ToolIds } from '@/shared/constants';
import type { RunEvent } from '@/shared/types/events';
import type { ToolCallContext } from '../domain/port/tool-call-context.port';
import AskUserTool from '../implementations/tools/AskUser';
import { AuthorizationService } from '@/server/libs/infrastructure/authorization.service';
import {
  AUTHORIZATION_PORT,
  type AuthAction,
  type AuthorizationPort,
  type EnsureApprovedOptions,
} from '../domain/port/authorization.port';

/**
 * 横切授权实现：session 持久 (action, resource) 决策。
 * 命中 workDir 文件授予直接放行；未命中且 interactive → 弹一次 AskUser，allow 追加写文件；
 * 非 interactive → 抛。deny 不写文件（允许重试改主意）。
 *
 * 真相源是 AuthorizationService 读写的工作区文件（跨 run、跨会话激活/失活持久）；
 * 本 provider 不再持内存缓存。grant 检查低频，v1 stateless 现读现写够用。
 */
@injectable()
export class AuthorizationProvider implements AuthorizationPort {
  constructor(
    @inject(AuthorizationService)
    private readonly authService: AuthorizationService,
  ) {}

  async *ensureApproved(
    ctx: ToolCallContext,
    action: AuthAction,
    resource: string,
    opts: EnsureApprovedOptions,
  ): AsyncGenerator<RunEvent, Record<string, unknown> | void, void> {
    const key = `${action}:${resource}`;

    if (await this.authService.hasGrant(ctx.conversationId, key)) return;

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

    const record = data as Record<string, unknown> | undefined;
    if (!submitted || !record?.confirmed) {
      const remark = record?.remark;
      throw new Error(
        remark
          ? `用户拒绝授权 ${action} 于 "${resource}": ${remark}`
          : `用户拒绝授权 ${action} 于 "${resource}"`,
      );
    }

    await this.authService.addGrant(ctx.conversationId, key);
    return record;
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
