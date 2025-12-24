export enum ToolIds {
  DATE_TIME = 'date_time_tool',
  LLM_CALL = 'llm_call_tool',
  TEXT_TO_SPEECH = 'text_to_speech_tool',
}

export enum AgentIds {
  CHAT_AGENT = 'chat_agent',
  REACT_AGENT = 'react_agent',
  GIRLFRIEND_AGENT = 'girlfriend_agent',
}

export const InjectTokens = {
  PG: Symbol('postgres'),
  REDIS: Symbol('redis'),
  OPENAI: Symbol('openai'),
};
