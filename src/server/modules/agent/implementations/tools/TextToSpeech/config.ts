import { ToolConfig } from '@/shared/types';
import {
  TTS_VOICES,
  TTS_EMOTIONS,
  type TtsVoice,
  type TtsEmotion,
} from '@/shared/constants';

export const config: ToolConfig<
  {
    text: string;
    reqId?: string;
    voice: TtsVoice;
    emotion?: TtsEmotion;
    speedRatio?: number;
  },
  {
    filename: string;
    voiceType: string;
    filePath: string;
  }
> = {
  name: 'TextToSpeech Tool',
  description: 'Converts text to speech audio file using TTS API.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        maxLength: 1024,
        description: 'The text content to be converted to speech.',
      },
      reqId: {
        type: 'string',
        description:
          'Unique request identifier used for tracking. Also used as output filename. Omit to default to the run id.',
        nullable: true,
      },
      voice: {
        type: 'string',
        enum: [...TTS_VOICES],
        description: 'Voice type to use for synthesis.',
      },
      emotion: {
        type: 'string',
        enum: [...TTS_EMOTIONS],
        default: 'hate',
        description: 'Emotional tone for the speech synthesis.',
        nullable: true,
      },
      speedRatio: {
        type: 'number',
        default: 1.2,
        minimum: 0.5,
        maximum: 2.0,
        description: 'Speech speed ratio between 0.5 (slow) and 2.0 (fast).',
        nullable: true,
      },
    },
    required: ['text', 'voice'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'The generated audio file name (format: {reqId}.mp3).',
      },
      voiceType: {
        type: 'string',
        description: 'The actual voice type used for synthesis.',
      },
      filePath: {
        type: 'string',
        description: 'Relative path to the generated audio file.',
      },
    },
    required: ['filename', 'voiceType', 'filePath'],
  },
};
