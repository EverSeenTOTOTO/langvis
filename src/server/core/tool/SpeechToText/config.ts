import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export const id = ToolIds.SPEECH_TO_TEXT;

export const config: ToolConfig<
  {
    filePath: string;
    mimeType: string;
    language?: string;
    temperature?: number;
    diarize?: boolean;
  },
  {
    task: string;
    language: string;
    text: string;
    requestId: string;
  }
> = {
  name: 'SpeechToText Tool',
  description: 'Transcribes audio files to text using STT API (Whisper).',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Relative path to the audio file under upload/ directory.',
      },
      mimeType: {
        type: 'string',
        description: 'MIME type of the audio file (e.g. audio/mp3, audio/wav).',
      },
      language: {
        type: 'string',
        description:
          'Language code for transcription (e.g. "zh", "en"). Empty string for auto-detect.',
        nullable: true,
      },
      temperature: {
        type: 'number',
        default: 0,
        minimum: 0,
        maximum: 1,
        description: 'Sampling temperature for transcription.',
        nullable: true,
      },
      diarize: {
        type: 'boolean',
        default: true,
        description: 'Whether to enable speaker diarization.',
        nullable: true,
      },
    },
    required: ['filePath', 'mimeType'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The task type returned by the API (e.g. "transcribe").',
      },
      language: {
        type: 'string',
        description: 'Detected or specified language code.',
      },
      text: {
        type: 'string',
        description: 'The transcribed text content.',
      },
      requestId: {
        type: 'string',
        description: 'Request ID from the API provider.',
      },
    },
    required: ['task', 'language', 'text', 'requestId'],
  },
};
