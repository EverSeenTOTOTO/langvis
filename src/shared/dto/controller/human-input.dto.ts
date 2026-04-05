import { BaseDto, dto } from '../base';

export interface SubmitHumanInputRequest {
  messageId: string;
  data: Record<string, unknown>;
}

@dto<SubmitHumanInputRequest>({
  type: 'object',
  properties: {
    messageId: { type: 'string' },
    data: {
      type: 'object',
      additionalProperties: true,
    },
  },
  required: ['messageId', 'data'],
  additionalProperties: false,
})
export class SubmitHumanInputRequestDto
  extends BaseDto
  implements SubmitHumanInputRequest
{
  messageId!: string;
  data!: Record<string, unknown>;
}

export interface SubmitHumanInputResponse {
  success: boolean;
  error?: string;
}

export interface GetHumanInputStatusRequest {
  messageId: string;
}

@dto<GetHumanInputStatusRequest>({
  type: 'object',
  properties: {
    messageId: { type: 'string' },
  },
  required: ['messageId'],
  additionalProperties: false,
})
export class GetHumanInputStatusRequestDto
  extends BaseDto
  implements GetHumanInputStatusRequest
{
  messageId!: string;
}

export interface GetHumanInputStatusResponse {
  exists: boolean;
  submitted?: boolean;
  message?: string;
  schema?: Record<string, unknown>;
}
