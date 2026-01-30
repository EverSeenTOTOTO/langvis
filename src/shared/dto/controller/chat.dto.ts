import { Role } from '@/shared/entities/Message';
import { BaseDto, dto } from '../base';

export interface InitSSERequest {
  conversationId: string;
}

@dto<InitSSERequest>({
  type: 'object',
  properties: {
    conversationId: { type: 'string' },
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

@dto<CancelChatRequest>({
  type: 'object',
  properties: {
    conversationId: { type: 'string' },
    messageId: { type: 'string' },
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

@dto<StartChatRequest>({
  type: 'object',
  properties: {
    conversationId: { type: 'string' },
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
