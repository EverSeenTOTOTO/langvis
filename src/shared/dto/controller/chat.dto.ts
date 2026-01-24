import { Role } from '@/shared/entities/Message';
import { BaseDto, Dto } from '../base';

export interface InitSSERequest {
  conversationId: string;
}

@Dto<InitSSERequest>({
  type: 'object',
  properties: {
    conversationId: { type: 'string', format: 'uuid' },
  },
  required: ['conversationId'],
  additionalProperties: false,
})
export class InitSSERequestDto extends BaseDto implements InitSSERequest {
  conversationId!: string;
}

export interface CancelChatRequest {
  conversationId: string;
  messageId: string;
  reason?: string;
}

@Dto<CancelChatRequest>({
  type: 'object',
  properties: {
    conversationId: { type: 'string', format: 'uuid' },
    messageId: { type: 'string', format: 'uuid' },
    reason: { type: 'string', nullable: true },
  },
  required: ['conversationId', 'messageId'],
  additionalProperties: false,
})
export class CancelChatRequestDto extends BaseDto implements CancelChatRequest {
  conversationId!: string;
  messageId!: string;
  reason?: string;
}

export interface CancelChatResponse {
  success: boolean;
}

export interface StartChatRequest {
  conversationId: string;
  role: Role;
  content: string;
}

@Dto<StartChatRequest>({
  type: 'object',
  properties: {
    conversationId: { type: 'string', format: 'uuid' },
    role: { type: 'string', enum: Object.values(Role) as Role[] },
    content: { type: 'string', minLength: 1 },
  },
  required: ['conversationId', 'role', 'content'],
  additionalProperties: false,
})
export class StartChatRequestDto extends BaseDto implements StartChatRequest {
  conversationId!: string;
  role!: Role;
  content!: string;
}

export interface StartChatResponse {
  success: boolean;
}
