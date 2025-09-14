export type SSEMessage =
  | { type: 'heartbeat' }
  | { type: 'completion_error'; error: string }
  | {
      type: 'completion_delta';
      content: string;
    }
  | {
      type: 'completion_done';
    };

export interface ConversationConfig {
  agent: string;
  [key: string]: any;
}
