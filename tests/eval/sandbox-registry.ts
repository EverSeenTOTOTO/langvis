// per-run 沙箱绑定：虚构工具是无状态 singleton，不能在构造里持沙箱（会串），
// 改由 runId 索引——runner 在 launch 前 bind、finally 里 unbind，工具经 getSandbox 取回。
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
