import { Role } from '@/shared/entities/Message';
import { Conversation, Message } from '@/shared/types/entities';
import { BaseDto, dto } from '../base';

export interface CreateConversationRequest {
  name: string;
  config: {
    agent: string;
    [key: string]: any;
  };
}

export type ConversationConfig = CreateConversationRequest['config'];

// @ts-expect-error ajv cannot handle `[key: string]: any`?
@dto<CreateConversationRequest>({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    config: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
      },
      required: ['agent'],
      additionalProperties: true,
    },
  },
  required: ['name', 'config'],
  additionalProperties: false,
})
export class CreateConversationRequestDto
  extends BaseDto
  implements CreateConversationRequest
{
  name!: string;
  config!: CreateConversationRequest['config'];
}

export interface GetAllConversationsRequest {}

@dto<GetAllConversationsRequest>({
  type: 'object',
  additionalProperties: false,
})
export class GetAllConversationsRequestDto
  extends BaseDto
  implements GetAllConversationsRequest {}

export interface GetAllConversationsResponse {
  conversations: Conversation[];
}

export interface GetConversationByIdRequest {
  id: string;
}

@dto<GetConversationByIdRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
})
export class GetConversationByIdRequestDto
  extends BaseDto
  implements GetConversationByIdRequest
{
  id!: string;
}

export interface UpdateConversationRequest {
  id: string;
  name: string;
  config: {
    agent: string;
    [key: string]: any;
  };
}

// @ts-expect-error ajv cannot handle `[key: string]: any`?
@dto<UpdateConversationRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string', minLength: 1 },
    config: {
      type: 'object',
      nullable: true,
      properties: {
        agent: { type: 'string' },
      },
      required: ['agent'],
      additionalProperties: true,
    },
  },
  required: ['id', 'name', 'config'],
  additionalProperties: false,
})
export class UpdateConversationRequestDto
  extends BaseDto
  implements UpdateConversationRequest
{
  id!: string;
  name!: string;
  config!: UpdateConversationRequest['config'];
}

export interface DeleteConversationRequest {
  id: string;
}

@dto<DeleteConversationRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
})
export class DeleteConversationRequestDto
  extends BaseDto
  implements DeleteConversationRequest
{
  id!: string;
}

export interface DeleteConversationResponse {
  success: boolean;
}

export interface AddMessageToConversationRequest {
  id: string;
  role: Role;
  content: string;
}

@dto<AddMessageToConversationRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
    role: { type: 'string', enum: Object.values(Role) as Role[] },
    content: { type: 'string', minLength: 1 },
  },
  required: ['id', 'role', 'content'],
  additionalProperties: false,
})
export class AddMessageToConversationRequestDto
  extends BaseDto
  implements AddMessageToConversationRequest
{
  id!: string;
  role!: Role;
  content!: string;
}

export interface GetMessagesByConversationIdRequest {
  id: string;
}

@dto<GetMessagesByConversationIdRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
})
export class GetMessagesByConversationIdRequestDto
  extends BaseDto
  implements GetMessagesByConversationIdRequest
{
  id!: string;
}

export interface GetMessagesByConversationIdResponse {
  messages: Message[];
}

export interface BatchDeleteMessagesInConversationRequest {
  id: string;
  messageIds: string[];
}

@dto<BatchDeleteMessagesInConversationRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
    messageIds: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    },
  },
  required: ['id', 'messageIds'],
  additionalProperties: false,
})
export class BatchDeleteMessagesInConversationRequestDto
  extends BaseDto
  implements BatchDeleteMessagesInConversationRequest
{
  id!: string;
  messageIds!: string[];
}

export interface BatchDeleteMessagesInConversationResponse {
  id: string;
}
