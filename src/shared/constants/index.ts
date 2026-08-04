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
  FILE_EDIT = 'file_edit',
  PDF_EXTRACT = 'pdf_extract',
  BASH = 'bash',
  LIST_TOOLS = 'list_tools',
  SKILL_CALL = 'skill_call',
  CALL_SUBAGENTS = 'call_subagents',

  // Internal tools (not exposed to agents directly)
  DOCUMENT_METADATA_EXTRACT = 'document_metadata_extract',
  CONTENT_CHUNK = 'content_chunk',
  EMBEDDING_GENERATE = 'embedding_generate',
  DOCUMENT_STORE = 'document_store',
}

export const UNGROUPED_GROUP_NAME = 'Ungrouped';

// Workspace-local / user-local hidden folder for config, grants and caches.
export const LANGVIS_DIR = '.langvis';

export { DEFAULT_UPLOAD_CONFIG } from './upload';
export {
  TTS_VOICES,
  TTS_EMOTIONS,
  type TtsVoice,
  type TtsEmotion,
} from './tts';
