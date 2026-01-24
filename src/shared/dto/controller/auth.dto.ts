import { BaseDto, Dto } from '../base';

export interface SignInEmailRequest {
  email: string;
  password: string;
  name?: string;
}

@Dto<SignInEmailRequest>({
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 6 },
    name: { type: 'string', nullable: true },
  },
  required: ['email', 'password'],
  additionalProperties: false,
})
export class SignInEmailRequestDto
  extends BaseDto
  implements SignInEmailRequest
{
  email!: string;
  password!: string;
  name?: string;
}

export interface SignUpEmailRequest {
  email: string;
  password: string;
  name: string;
}

@Dto<SignUpEmailRequest>({
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 6 },
    name: { type: 'string', minLength: 1 },
  },
  required: ['email', 'password', 'name'],
  additionalProperties: false,
})
export class SignUpEmailRequestDto
  extends BaseDto
  implements SignUpEmailRequest
{
  email!: string;
  password!: string;
  name!: string;
}

export interface SignOutRequest {}

@Dto<SignOutRequest>({
  type: 'object',
  additionalProperties: false,
})
export class SignOutRequestDto extends BaseDto implements SignOutRequest {}

export interface GetSessionRequest {}

@Dto<GetSessionRequest>({
  type: 'object',
  additionalProperties: false,
})
export class GetSessionRequestDto
  extends BaseDto
  implements GetSessionRequest {}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignInEmailResponse {
  user?: AuthUser;
  session?: {
    token: string;
    expiresAt: string;
  };
}

export interface SignUpEmailResponse {
  user?: AuthUser;
  session?: {
    token: string;
    expiresAt: string;
  };
}

export interface SignOutResponse {
  success: boolean;
}

export interface GetSessionResponse {
  user?: AuthUser;
  session?: {
    token: string;
    expiresAt: string;
  };
}
