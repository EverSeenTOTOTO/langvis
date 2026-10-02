// 创建超时或父 signal 中止时的 AbortController，返回 controller + cleanup 函数。
export function createTimeoutController(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): [controller: AbortController, cleanup: () => void] {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  const onTimeout = () => {
    controller.abort(
      new Error(`Operation timed out after ${timeoutMs / 1000}s`),
    );
    cleanup();
  };

  const onParentAbort = () => {
    controller.abort(parentSignal!.reason);
    cleanup();
  };

  timeoutId = setTimeout(onTimeout, timeoutMs);

  if (parentSignal) {
    parentSignal.addEventListener('abort', onParentAbort);
  }

  return [controller, cleanup];
}

/** 可中止的延时：到时 resolve；signal 先 abort 则 reject（reason）。 */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    }
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
