import { BaseDto, dto } from '../base';

export interface SubmitHumanInputRequest {
  runId: string;
  data: Record<string, unknown>;
}

@dto<SubmitHumanInputRequest>({
  type: 'object',
  properties: {
    runId: { type: 'string' },
    data: {
      type: 'object',
      additionalProperties: true,
    },
  },
  required: ['runId', 'data'],
  additionalProperties: false,
})
export class SubmitHumanInputRequestDto
  extends BaseDto
  implements SubmitHumanInputRequest
{
  runId!: string;
  data!: Record<string, unknown>;
}

export interface SubmitHumanInputResponse {
  success: boolean;
  error?: string;
}

export interface GetHumanInputStatusRequest {
  runId: string;
}

@dto<GetHumanInputStatusRequest>({
  type: 'object',
  properties: {
    runId: { type: 'string' },
  },
  required: ['runId'],
  additionalProperties: false,
})
export class GetHumanInputStatusRequestDto
  extends BaseDto
  implements GetHumanInputStatusRequest
{
  runId!: string;
}

export interface GetHumanInputStatusResponse {
  exists: boolean;
  submitted?: boolean;
  message?: string;
  schema?: Record<string, unknown>;
}
