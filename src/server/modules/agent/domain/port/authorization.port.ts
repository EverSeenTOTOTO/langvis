import type { RunEvent } from '@/shared/types/events';
import type { ToolCallContext } from './tool-call-context.port';

/**
 * 横切授权能力：Principal(runId) × Action × Resource。
 * 越界工具（读任意路径 / 跑宿主命令 / 写任意路径）共用此门，
 * 不在各自工具内私藏批准集。作用域 per-run：一个 run 内同一三元组授权一次即生效。
 */
export type AuthAction = 'read-path' | 'exec-cmd' | 'edit-path';

export interface EnsureApprovedOptions {
  /** HITL 展示给用户的说明文案（markdown）。 */
  prompt: string;
  /** AskUser 表单 schema（含 confirmed 等字段）。 */
  formSchema: object;
}

export interface AuthorizationPort {
  /**
   * 确保 (ctx.runId, action, resource) 已获授权。
   * - 命中本 run 缓存 → 直接 return；
   * - 未缓存且 ctx.interactive → 弹一次 AskUser（复用传入的 ctx：signal/runId/interactive），
   *   allow 则缓存，deny 则抛（deny 不缓存，允许重试改主意）；
   * - 非 interactive → 直接抛（与 AskUser fail-fast 一致）。
   */
  ensureApproved(
    ctx: ToolCallContext,
    action: AuthAction,
    resource: string,
    opts: EnsureApprovedOptions,
  ): AsyncGenerator<RunEvent, void, void>;
}

export const AUTHORIZATION_PORT = Symbol('AUTHORIZATION_PORT');
