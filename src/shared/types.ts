export type StreamChunk =
  | string
  | {
      type: 'chunk';
      data: string;
    }
  | {
      type: 'meta';
      data: Record<string, any>;
    };

export type SSEMessage =
  | { type: 'heartbeat' }
  | { type: 'completion_error'; error: string }
  | {
      type: 'completion_delta';
      content?: string;
      meta?: Record<string, any>;
    }
  | {
      type: 'completion_done';
    };

export interface ConversationConfig {
  agent: string;
  [key: string]: any;
}
