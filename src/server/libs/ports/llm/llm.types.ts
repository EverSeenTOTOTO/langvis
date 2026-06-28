/**
 * TTS/STT I/O 契约——LlmPort 与 agent 工具（TextToSpeech / SpeechToText）共用。
 * 置于内核，避免 LLM 端口（被 memory 实现）反向依赖 agent 工具层。
 */
export interface TextToSpeechInput {
  modelId?: string;
  text: string;
  reqId: string;
  voice: string;
  emotion?: string;
  speedRatio?: number;
}

export interface TextToSpeechOutput {
  voice: string;
  filePath: string;
}

export interface SpeechToTextInput {
  modelId?: string;
  filePath: string;
  mimeType: string;
  language?: string;
  temperature?: number;
  diarize?: boolean;
}

export interface SpeechToTextOutput {
  task: string;
  language: string;
  text: string;
  requestId: string;
}
