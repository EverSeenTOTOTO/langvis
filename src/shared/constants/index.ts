export enum ToolIds {
  DATE_TIME = 'date_time_tool',
  LLM_CALL = 'llm_call_tool',
  TEXT_TO_SPEECH = 'text_to_speech_tool',
  WEB_FETCH = 'web_fetch_tool',
  HUMAN_IN_THE_LOOP = 'human_in_the_loop_tool',
  META_EXTRACT = 'meta_extract_tool',
  CHUNK = 'chunk_tool',
  EMBED = 'embed_tool',
  ARCHIVE = 'archive_tool',
  ANALYSIS = 'analysis_tool',
  RETRIEVE = 'retrieve_tool',
  READ_CACHE = 'read_cache_tool',
}

export enum AgentIds {
  DOCUMENT_CONCLUDE = 'document_conclude_agent',
  CHAT = 'chat_agent',
  REACT = 'react_agent',
  GIRLFRIEND = 'girlfriend_agent',
  DOCUMENT = 'document_agent',
}

export enum MemoryIds {
  NONE = 'no_memory',
  CHAT_HISTORY = 'chat_history_memory',
}

export const InjectTokens = {
  PG: Symbol('postgres'),
  REDIS: Symbol('redis'),
  REDIS_SUBSCRIBER: Symbol('redis-subscriber'),
  OPENAI: Symbol('openai'),
};

export const UNGROUPED_GROUP_NAME = 'Ungrouped';
