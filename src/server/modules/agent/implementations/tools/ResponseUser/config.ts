import { ToolConfig } from '@/shared/types';
import {
  TTS_VOICES,
  TTS_EMOTIONS,
  type TtsVoice,
  type TtsEmotion,
} from '@/shared/constants';

export interface ResponseUserTtsConfig {
  enabled: boolean;
  voice?: TtsVoice;
  emotion?: TtsEmotion;
  speedRatio?: number;
}

export const config: ToolConfig<
  {
    message: string;
    tts?: ResponseUserTtsConfig;
  },
  {
    delivered: boolean;
  }
> = {
  name: 'ResponseUser Tool',
  description: `Deliver the final answer or result to the user. This is the ONLY way to reply to the user and ends the agent run.

**When to use:**
- You have the answer to the user's question (after reasoning and/or tool usage).
- A task is complete and you are reporting the outcome.
- No further tool calls are needed.

**Do NOT confuse with \`ask_user\`:**
- \`response_user\` — you GIVE the answer/result to the user (one-way, terminates the run).
- \`ask_user\` — you REQUEST input/confirmation FROM the user (two-way, pauses for a reply).

**Voice reply (optional):** attach \`tts: { enabled: true, voice, emotion }\` to also synthesize the reply to speech (rendered as an audio player below the reply). Disabled by default — only enable when a voice reply is explicitly requested.

Always prefer \`response_user\` once you can answer; only use \`ask_user\` when you genuinely need information from the user to proceed.
`,
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'The final reply to present to the user. Write it as a complete, self-contained answer in the output language.',
      },
      tts: {
        type: 'object',
        description:
          'Optional voice reply. When enabled, the message is also synthesized to speech and rendered as an audio player below the reply. Disabled by default — only enable when a voice reply is explicitly requested (e.g. a voice-assistant persona).',
        properties: {
          enabled: {
            type: 'boolean',
            default: false,
            description: 'Whether to synthesize speech for this reply.',
          },
          voice: {
            type: 'string',
            enum: [...TTS_VOICES],
            description: 'TTS voice id to use for synthesis.',
            nullable: true,
          },
          emotion: {
            type: 'string',
            enum: [...TTS_EMOTIONS],
            description: 'Emotional tone for the speech synthesis.',
            nullable: true,
          },
          speedRatio: {
            type: 'number',
            minimum: 0.5,
            maximum: 2.0,
            description:
              'Speech speed ratio between 0.5 (slow) and 2.0 (fast).',
            nullable: true,
          },
        },
        required: ['enabled'],
        nullable: true,
      },
    },
    required: ['message'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      delivered: {
        type: 'boolean',
        description: 'Whether the message was delivered to the user.',
      },
    },
    required: ['delivered'],
  },
};
