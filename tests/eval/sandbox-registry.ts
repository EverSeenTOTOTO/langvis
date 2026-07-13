/**
 * per-run 沙箱绑定。虚构工具是无状态 singleton（registerTool 注册为 Singleton，
 * 跨 run 共享实例），不能在构造里持沙箱（会串）。改由 runId 索引：
 * runner 在 launch 前 bindSandbox(runId, backend)、finally 里 unbind；
 * 工具 call(ctx) 里 getSandbox&lt;B&gt;(ctx.runId) 取回本 run 的沙箱。
 * 串行安全；并发也安全（runId 唯一）。
 */
const sandboxes = new Map<string, unknown>();

export function bindSandbox(runId: string, backend: unknown): void {
  sandboxes.set(runId, backend);
}

export function unbindSandbox(runId: string): void {
  sandboxes.delete(runId);
}

export function getSandbox<B>(runId: string): B {
  const b = sandboxes.get(runId);
  if (!b) throw new Error(`no sandbox bound for run ${runId}`);
  return b as B;
}
