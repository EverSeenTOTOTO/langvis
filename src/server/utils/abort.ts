/**
 * Creates an AbortController that aborts after a timeout or when the parent signal aborts.
 * Returns the controller and a cleanup function that must be called to clear resources.
 *
 * @param timeoutMs - Timeout in milliseconds
 * @param parentSignal - Optional parent signal to propagate abort
 * @returns Tuple of [controller, cleanup function]
 *
 * @example
 * ```ts
 * const [controller, cleanup] = createTimeoutController(30000, ctx.signal);
 * try {
 *   const response = await fetch(url, { signal: controller.signal });
 *   // ...
 * } finally {
 *   cleanup(); // clears timeout and removes event listener
 * }
 * ```
 */
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
