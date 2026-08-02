import os from 'node:os';
import path from 'node:path';
import { injectable, inject, container } from 'tsyringe';
import { ToolIds } from '@/shared/constants';
import type { RunEvent } from '@/shared/types/events';
import type { ToolCallContext } from '../domain/port/tool-call-context.port';
import AskUserTool from '../implementations/tools/AskUser';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import {
  AUTHORIZATION_PORT,
  type AuthAction,
  type AuthorizationPort,
  type EnsureApprovedOptions,
} from '../domain/port/authorization.port';

// 横切授权实现：session 持久 (action, resource) 决策。命中 grants 直放行；interactive 弹 AskUser，allow 追加写文件。
// grants 真相源 = workDir 的 `.langvis/config.json` 的 grants 段，经 WorkspaceService 整对象读写，跨 run 持久。
@injectable()
export class AuthorizationProvider implements AuthorizationPort {
  constructor(
    @inject(WorkspaceService)
    private readonly workspace: WorkspaceService,
  ) {}

  async *ensureApproved(
    ctx: ToolCallContext,
    action: AuthAction,
    resource: string,
    opts: EnsureApprovedOptions,
  ): AsyncGenerator<RunEvent, Record<string, unknown> | void, void> {
    const key = `${action}:${resource}`;

    if (await this.hasGrant(ctx.workDir, key)) return;

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

    await this.addGrant(ctx.workDir, key);
    return record;
  }

  private async hasGrant(workDir: string, key: string): Promise<boolean> {
    const grants = (await this.workspace.readConfig(workDir))?.grants;
    return Array.isArray(grants) && grants.includes(key);
  }

  private async addGrant(workDir: string, key: string): Promise<void> {
    const cfg = (await this.workspace.readConfig(workDir)) ?? {};
    const prev = cfg.grants;
    const grants: string[] = Array.isArray(prev)
      ? prev.filter((k): k is string => typeof k === 'string')
      : [];
    if (grants.includes(key)) return;
    grants.push(key);
    cfg.grants = grants;
    await this.workspace.writeConfig(workDir, cfg);
  }
}

// 单文件 → 直接父目录；glob → 通配符前的稳定前缀目录。
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
