// Stand-in for antd toasts: TUI has no DOM, so sinks to console. Drop-in: notifier.error(msg).
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
