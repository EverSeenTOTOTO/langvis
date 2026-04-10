export enum ToolIds {
  // High-level tools for agents
  DATETIME_GET = 'datetime_get',
  LLM_CALL = 'llm_call',
  TEXT_TO_SPEECH = 'text_to_speech',
  WEB_FETCH = 'web_fetch',
  ASK_USER = 'ask_user',
  DOCUMENT_ARCHIVE = 'document_archive',
  DOCUMENT_SEARCH = 'document_search',
  DOCUMENT_ARCHIVE_BATCH = 'document_archive_batch',
  LINKS_EXTRACT = 'links_extract',
  CACHED_READ = 'cached_read',
  POSITION_ADJUSTMENT_ADVICE = 'position_adjustment_advice',
  FILE_EDIT = 'file_edit',
  BASH = 'bash',
  AGENT_CALL = 'agent_call',
  LIST_TOOLS = 'list_tools',

  // Internal tools (not exposed to agents directly)
  DOCUMENT_METADATA_EXTRACT = 'document_metadata_extract',
  CONTENT_CHUNK = 'content_chunk',
  EMBEDDING_GENERATE = 'embedding_generate',
  DOCUMENT_STORE = 'document_store',
}

export enum AgentIds {
  DOCUMENT_CONCLUDE = 'document_conclude_agent',
  CHAT = 'chat_agent',
  REACT = 'react_agent',
  GIRLFRIEND = 'girlfriend_agent',
  DOCUMENT = 'document_agent',
  FINANCIAL = 'financial_agent',
}

export enum MemoryIds {
  NONE = 'no_memory',
  CHAT_HISTORY = 'chat_history_memory',
  CHILD = 'child_memory',
}

export const InjectTokens = {
  PG: Symbol('postgres'),
};

export const UNGROUPED_GROUP_NAME = 'Ungrouped';

export const RedisKeys = {
  // Message level
  HUMAN_INPUT: (messageId: string) => `human_input:${messageId}`,
  AGENT_CACHE: (messageId: string, key: string) =>
    `agent:cache:${messageId}:${key}`,

  // Session level
  CHAT_SESSION: (conversationId: string) => `chat_session:${conversationId}`,
  CHAT_SESSION_LOCK: (conversationId: string) =>
    `chat_session_lock:${conversationId}`,
};
