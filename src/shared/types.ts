export type SSEMessage =
  | { type: 'heartbeat' }
  | {
      type: 'reply';
      content: string;
    };
