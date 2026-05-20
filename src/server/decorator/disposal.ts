import { container } from 'tsyringe';
import logger from '../utils/logger';

const disposableTokens: any[] = [];

/** Register a class token for disposal tracking.
 *  Called by @service() and @tool() decorators. */
export function registerDisposableToken(token: any): void {
  disposableTokens.push(token);
}

/** Call dispose() on all registered tokens that implement it.
 *  Errors are logged but do not stop other instances from being disposed. */
export async function disposeAll(): Promise<void> {
  for (const token of disposableTokens) {
    try {
      const instance = container.resolve(token) as unknown as {
        dispose?: () => Promise<void>;
      };
      if (instance && typeof instance.dispose === 'function') {
        await instance.dispose();
      }
    } catch (err) {
      logger.error(`Failed to dispose ${token.name ?? String(token)}:`, err);
    }
  }
}
