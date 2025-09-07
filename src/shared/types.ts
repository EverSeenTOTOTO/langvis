export type SSEMessage =
  | { type: 'heartbeat' }
  | { type: 'completion_error'; error: string }
  | {
      type: 'completion_delta';
      content: string;
    }
  | {
      type: 'completion_done';
      finish_reaseon: string | null;
    };
