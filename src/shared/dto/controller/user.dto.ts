import { BaseDto, dto } from '../base';

export interface UserData {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetAllUsersRequest {}

@dto<GetAllUsersRequest>({
  type: 'object',
  additionalProperties: false,
})
export class GetAllUsersRequestDto
  extends BaseDto
  implements GetAllUsersRequest {}

export interface GetAllUsersResponse {
  users: UserData[];
}

export interface GetUserByIdRequest {
  id: string;
}

@dto<GetUserByIdRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
})
export class GetUserByIdRequestDto
  extends BaseDto
  implements GetUserByIdRequest
{
  id!: string;
}

export interface GetUserByEmailRequest {
  email: string;
}

@dto<GetUserByEmailRequest>({
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
  },
  required: ['email'],
  additionalProperties: false,
})
export class GetUserByEmailRequestDto
  extends BaseDto
  implements GetUserByEmailRequest
{
  email!: string;
}
