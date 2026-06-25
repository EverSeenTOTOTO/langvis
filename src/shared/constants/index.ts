export enum ToolIds {
  // High-level tools for agents
  DATETIME_GET = 'datetime_get',
  LLM_CALL = 'llm_call',
  TEXT_TO_SPEECH = 'text_to_speech',
  SPEECH_TO_TEXT = 'speech_to_text',
  WEB_FETCH = 'web_fetch',
  ASK_USER = 'ask_user',
  RESPONSE_USER = 'response_user',
  DOCUMENT_SEARCH = 'document_search',
  LINKS_EXTRACT = 'links_extract',
  CACHED_READ = 'cached_read',
  POSITION_ADJUSTMENT_ADVICE = 'position_adjustment_advice',
  FILE_EDIT = 'file_edit',
  BASH = 'bash',
  LIST_TOOLS = 'list_tools',
  SKILL_CALL = 'skill_call',

  // Internal tools (not exposed to agents directly)
  DOCUMENT_METADATA_EXTRACT = 'document_metadata_extract',
  CONTENT_CHUNK = 'content_chunk',
  EMBEDDING_GENERATE = 'embedding_generate',
  DOCUMENT_STORE = 'document_store',
}

export const UNGROUPED_GROUP_NAME = 'Ungrouped';

export const RedisKeys = {
  // Per-run level (HITL 关联键：AskUser 写、HumanInputPort 读，均以 runId 为准；
  // HTTP 端点 :messageId 在 HumanInputRedisProvider 边界翻译成 runId)
  HUMAN_INPUT: (runId: string) => `human_input:${runId}`,
  // Session level
  CHAT_SESSION: (conversationId: string) => `chat_session:${conversationId}`,
  CHAT_SESSION_LOCK: (conversationId: string) =>
    `chat_session_lock:${conversationId}`,
};
