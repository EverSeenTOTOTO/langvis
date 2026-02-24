import { BaseDto, dto } from '../base';

export interface SubmitHumanInputRequest {
  conversationId: string;
  data: Record<string, unknown>;
}

@dto<SubmitHumanInputRequest>({
  type: 'object',
  properties: {
    conversationId: { type: 'string' },
    data: {
      type: 'object',
      additionalProperties: true,
    },
  },
  required: ['conversationId', 'data'],
  additionalProperties: false,
})
export class SubmitHumanInputRequestDto
  extends BaseDto
  implements SubmitHumanInputRequest
{
  conversationId!: string;
  data!: Record<string, unknown>;
}

export interface SubmitHumanInputResponse {
  success: boolean;
  error?: string;
}

export interface GetHumanInputStatusRequest {
  conversationId: string;
}

@dto<GetHumanInputStatusRequest>({
  type: 'object',
  properties: {
    conversationId: { type: 'string' },
  },
  required: ['conversationId'],
  additionalProperties: false,
})
export class GetHumanInputStatusRequestDto
  extends BaseDto
  implements GetHumanInputStatusRequest
{
  conversationId!: string;
}

export interface GetHumanInputStatusResponse {
  exists: boolean;
  submitted?: boolean;
  message?: string;
  schema?: Record<string, unknown>;
}
