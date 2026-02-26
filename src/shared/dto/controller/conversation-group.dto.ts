import { ConversationGroup } from '@/shared/types/entities';
import { BaseDto, dto } from '../base';

export interface CreateConversationGroupRequest {
  name: string;
}

@dto<CreateConversationGroupRequest>({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
  },
  required: ['name'],
  additionalProperties: false,
})
export class CreateConversationGroupRequestDto
  extends BaseDto
  implements CreateConversationGroupRequest
{
  name!: string;
}

export interface UpdateConversationGroupRequest {
  id: string;
  name: string;
}

@dto<UpdateConversationGroupRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string', minLength: 1 },
  },
  required: ['id', 'name'],
  additionalProperties: false,
})
export class UpdateConversationGroupRequestDto
  extends BaseDto
  implements UpdateConversationGroupRequest
{
  id!: string;
  name!: string;
}

export interface DeleteConversationGroupRequest {
  id: string;
}

@dto<DeleteConversationGroupRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
})
export class DeleteConversationGroupRequestDto
  extends BaseDto
  implements DeleteConversationGroupRequest
{
  id!: string;
}

export interface DeleteConversationGroupResponse {
  success: boolean;
  deletedConversationIds: string[];
}

export interface ReorderItemsRequest {
  items: Array<{
    id: string;
    type: 'group';
    order: number;
  }>;
}

@dto<ReorderItemsRequest>({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', const: 'group' },
          order: { type: 'integer' },
        },
        required: ['id', 'type', 'order'],
      },
      minItems: 1,
    },
  },
  required: ['items'],
  additionalProperties: false,
})
export class ReorderItemsRequestDto
  extends BaseDto
  implements ReorderItemsRequest
{
  items!: ReorderItemsRequest['items'];
}

export interface ReorderConversationsInGroupRequest {
  groupId: string;
  items: Array<{ id: string; order: number }>;
}

@dto<ReorderConversationsInGroupRequest>({
  type: 'object',
  properties: {
    groupId: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          order: { type: 'integer' },
        },
        required: ['id', 'order'],
      },
      minItems: 1,
    },
  },
  required: ['groupId', 'items'],
  additionalProperties: false,
})
export class ReorderConversationsInGroupRequestDto
  extends BaseDto
  implements ReorderConversationsInGroupRequest
{
  groupId!: string;
  items!: ReorderConversationsInGroupRequest['items'];
}

export interface GetAllConversationGroupsResponse {
  groups: Array<{
    id: string;
    name: string;
    order: number;
    conversations: ConversationGroup['conversations'];
  }>;
}
