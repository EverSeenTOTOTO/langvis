import { createTimeoutController } from '@/server/utils/abort';
import { describe, expect, it } from 'vitest';

describe('createTimeoutController', () => {
  it('should create a controller that aborts after timeout', async () => {
    const [controller, cleanup] = createTimeoutController(50);

    expect(controller.signal.aborted).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason.message).toContain('timed out');

    cleanup();
  });

  it('should abort when parent signal aborts', () => {
    const parentController = new AbortController();
    const [controller, cleanup] = createTimeoutController(
      10000,
      parentController.signal,
    );

    expect(controller.signal.aborted).toBe(false);

    parentController.abort(new Error('Parent cancelled'));

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason.message).toBe('Parent cancelled');

    cleanup();
  });

  it('should cleanup timeout and event listener', async () => {
    const parentController = new AbortController();
    const [controller, cleanup] = createTimeoutController(
      100,
      parentController.signal,
    );

    // Clean up before timeout
    cleanup();

    // Wait for timeout to pass
    await new Promise(resolve => setTimeout(resolve, 150));

    // Controller should not be aborted because cleanup cleared the timeout
    expect(controller.signal.aborted).toBe(false);

    // Parent abort listener should be removed
    parentController.abort();
    expect(controller.signal.aborted).toBe(false);
  });

  it('should work without parent signal', async () => {
    const [controller, cleanup] = createTimeoutController(50);

    expect(controller.signal.aborted).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(controller.signal.aborted).toBe(true);

    cleanup();
  });
});
