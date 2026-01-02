export enum ToolIds {
  DATE_TIME = 'date_time_tool',
  LLM_CALL = 'llm_call_tool',
  TEXT_TO_SPEECH = 'text_to_speech_tool',
  WEB_FETCH = 'web_fetch_tool',
}

export enum AgentIds {
  DOCUMENT_CONCLUDE = 'document_conclude_agent',
  CHAT = 'chat_agent',
  REACT = 'react_agent',
  GIRLFRIEND = 'girlfriend_agent',
}

export const InjectTokens = {
  PG: Symbol('postgres'),
  REDIS: Symbol('redis'),
  OPENAI: Symbol('openai'),
};
