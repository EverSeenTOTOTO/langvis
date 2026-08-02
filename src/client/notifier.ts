/** Headless stand-in for the antd `message` toasts. The original client used
 * antd for error popups; the TUI has no DOM, so this sinks to the console until
 * a TUI status/toast surface is wired. Drop-in: `notifier.error(msg)`. */
type Msg = unknown;

const fmt = (msg: Msg): string =>
  msg instanceof Error ? msg.message : String(msg);

export const notifier = {
  error(msg: Msg): void {
    console.error(`[notify] ${fmt(msg)}`);
  },
  success(_msg: Msg): void {},
  info(_msg: Msg): void {},
  warning(_msg: Msg): void {},
  loading(_msg: Msg): () => void {
    return () => {};
  },
  destroy(): void {},
};

export default notifier;
