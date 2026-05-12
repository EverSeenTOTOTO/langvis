import { BaseDto, dto } from '../base';

export interface SpeechToTextRequest {
  filePath: string;
  mimeType: string;
  language?: string;
  temperature?: number;
  diarize?: boolean;
}

@dto<SpeechToTextRequest>({
  type: 'object',
  properties: {
    filePath: { type: 'string', minLength: 1 },
    mimeType: { type: 'string', minLength: 1 },
    language: { type: 'string', nullable: true },
    temperature: { type: 'number', minimum: 0, maximum: 1, nullable: true },
    diarize: { type: 'boolean', nullable: true },
  },
  required: ['filePath', 'mimeType'],
  additionalProperties: false,
})
export class SpeechToTextRequestDto
  extends BaseDto
  implements SpeechToTextRequest
{
  filePath!: string;
  mimeType!: string;
  language?: string;
  temperature?: number;
  diarize?: boolean;
}

export interface SpeechToTextResponse {
  task: string;
  language: string;
  text: string;
  requestId: string;
}
