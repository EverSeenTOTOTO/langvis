export type SSEMessage =
  | { type: 'heartbeat' }
  | { type: 'error'; error: string }
  | {
      type: 'reply';
      content: string;
    };
