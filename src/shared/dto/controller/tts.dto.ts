import { BaseDto, dto } from '../base';

export interface GenerateTTSRequest {
  text: string;
  reqId?: string;
  voiceType?: string;
  emotion?: string;
  speedRatio?: number;
}

@dto<GenerateTTSRequest>({
  type: 'object',
  properties: {
    text: { type: 'string', minLength: 1 },
    reqId: { type: 'string', nullable: true },
    voiceType: { type: 'string', nullable: true },
    emotion: { type: 'string', nullable: true },
    speedRatio: { type: 'number', minimum: 0.5, maximum: 2.0, nullable: true },
  },
  required: ['text'],
  additionalProperties: false,
})
export class GenerateTTSRequestDto
  extends BaseDto
  implements GenerateTTSRequest
{
  text!: string;
  reqId?: string;
  voiceType?: string;
  emotion?: string;
  speedRatio?: number;
}

export interface GenerateTTSResponse {
  success: boolean;
  data?: any;
}
