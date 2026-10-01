import { ModuleRef } from '@nestjs/core';
import os from 'node:os';
import path from 'node:path';
import { ToolIds } from '@/shared/constants';
import type { RunEvent } from '@/shared/types/events';
import type { ToolCallContext } from '../domain/port/tool-call-context.port';
import AskUserTool from '../implementations/tools/AskUser';
import { WorkspaceLocalStore } from '@/server/infrastructure/workspace/workspace-local-store';
import { Inject } from '@nestjs/common';
import {
  AUTHORIZATION_PORT,
  type AuthAction,
  type AuthorizationPort,
  type EnsureApprovedOptions,
} from '../domain/port/authorization.port';

// 横切授权实现：session 持久 (action, resource) 决策。命中 grants 直放行；interactive 弹 AskUser，allow 追加写文件。
// grants 真相源 = workDir 的 `.langvis/grants.json`（WorkspaceLocalStore section），跨 run 持久。
export class AuthorizationProvider implements AuthorizationPort {
  constructor(
    @Inject(WorkspaceLocalStore)
    private readonly store: WorkspaceLocalStore,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  async *ensureApproved(
    ctx: ToolCallContext,
    action: AuthAction,
    resource: string,
    opts: EnsureApprovedOptions,
  ): AsyncGenerator<RunEvent, Record<string, unknown> | void, void> {
    const key = `${action}:${resource}`;
    const mode = this.approvalMode(ctx);

    // yolo：全部直放（grants 语义保持——已有 grant 的照旧命中）
    if (mode === 'yolo') return;

    // auto：read 类直放（写类继续走确认）
    if (mode === 'auto' && action === 'read-path') return;

    if (await this.hasGrant(ctx.workDir, key)) return;

    if (!ctx.interactive) {
      throw new Error(
        `Authorization for ${action} on "${resource}" unavailable in non-interactive (sub-agent) run; cannot request user input`,
      );
    }

    const askUser = this.moduleRef.get<AskUserTool>(ToolIds.ASK_USER, {
      strict: false,
    });
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

  /** 审批模式来自 runtimeConfig.approval.mode（Config fragment 默认 default）。 */
  private approvalMode(ctx: ToolCallContext): 'default' | 'auto' | 'yolo' {
    const mode = (
      ctx.runtimeConfig as { approval?: { mode?: unknown } } | undefined
    )?.approval?.mode;
    return mode === 'auto' || mode === 'yolo' ? mode : 'default';
  }

  private async hasGrant(workDir: string, key: string): Promise<boolean> {
    const grants = await this.readGrants(workDir);
    return grants.includes(key);
  }

  /** 读 grants；缺文件时做一次性迁移（旧 config.json.grants → grants.json）。 */
  private async readGrants(workDir: string): Promise<string[]> {
    let grants = await this.store.readSection<string[]>(workDir, 'grants');
    if (!grants) {
      // 一次性迁移：旧 config.json 的 grants 段 → grants.json。
      const legacy = (
        await this.store.readSection<{ grants?: unknown }>(workDir, 'config')
      )?.grants;
      if (Array.isArray(legacy)) {
        grants = legacy.filter((k): k is string => typeof k === 'string');
        await this.store.writeSection(workDir, 'grants', grants);
      }
    }
    return grants ?? [];
  }

  private async addGrant(workDir: string, key: string): Promise<void> {
    const grants = await this.readGrants(workDir);
    if (grants.includes(key)) return;
    grants.push(key);
    await this.store.writeSection(workDir, 'grants', grants);
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
