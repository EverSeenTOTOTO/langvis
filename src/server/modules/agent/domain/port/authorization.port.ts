import type { RunEvent } from '@/shared/types/events';
import type { ToolCallContext } from './tool-call-context.port';

// 横切授权：Principal(conversationId)×Action×Resource。越界工具共用此门；grant 持久于 workDir 文件，跨 run 复用。
export type AuthAction = 'read-path' | 'exec-cmd' | 'edit-path';

export interface EnsureApprovedOptions {
  /** HITL 展示给用户的说明文案（markdown）。 */
  prompt: string;
  /** AskUser 表单 schema（含 confirmed 等字段）。 */
  formSchema: object;
}

export interface AuthorizationPort {
  // ensureApproved：命中已授 → return；interactive 弹 AskUser（allow 写文件返 data，deny 抛）；非 interactive → 抛。
  ensureApproved(
    ctx: ToolCallContext,
    action: AuthAction,
    resource: string,
    opts: EnsureApprovedOptions,
  ): AsyncGenerator<RunEvent, Record<string, unknown> | void, void>;
}

export const AUTHORIZATION_PORT = Symbol('AUTHORIZATION_PORT');
