import type { RunEvent } from '@/shared/types/events';
import type { ToolCallContext } from './tool-call-context.port';

/**
 * 横切授权能力：Principal(conversationId) × Action × Resource。
 * 越界工具（读任意路径 / 跑宿主命令 / 写任意路径）共用此门，
 * 不在各自工具内私藏批准集。作用域 session：同一会话内同一三元组授权一次即生效，
 * grant 持久于 workDir 文件，跨 run 复用（会话激活/失活后仍在）。
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
   * 确保 (ctx.conversationId, action, resource) 已获授权。
   * - 命中 session 文件授予 → 直接 return（无返回值）；
   * - 未授予且 ctx.interactive → 弹一次 AskUser（复用传入的 ctx：signal/runId/interactive），
   *   allow 则追加写文件并返回 AskUser data（含用户调过的 timeout 等表单字段），
   *   deny 则抛（deny 不写文件，允许重试改主意）；
   * - 非 interactive → 直接抛（与 AskUser fail-fast 一致）。
   */
  ensureApproved(
    ctx: ToolCallContext,
    action: AuthAction,
    resource: string,
    opts: EnsureApprovedOptions,
  ): AsyncGenerator<RunEvent, Record<string, unknown> | void, void>;
}

export const AUTHORIZATION_PORT = Symbol('AUTHORIZATION_PORT');
