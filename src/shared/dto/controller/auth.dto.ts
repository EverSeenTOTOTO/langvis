import { Expose } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { BaseDto } from '../base';

export class SignInEmailRequestDto extends BaseDto {
  @Expose()
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @Expose()
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @Expose()
  @IsString()
  @IsOptional()
  name?: string;
}

export class SignUpEmailRequestDto extends BaseDto {
  @Expose()
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @Expose()
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @Expose()
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class SignOutRequestDto extends BaseDto {}

export class GetSessionRequestDto extends BaseDto {}

export class AuthUserDto extends BaseDto {
  @Expose()
  id!: string;

  @Expose()
  email!: string;

  @Expose()
  name!: string;

  @Expose()
  emailVerified!: boolean;

  @Expose()
  image?: string | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}

export class SignInEmailResponseDto extends BaseDto {
  @Expose()
  user?: AuthUserDto;

  @Expose()
  session?: {
    token: string;
    expiresAt: Date;
  };
}

export class SignUpEmailResponseDto extends BaseDto {
  @Expose()
  user?: AuthUserDto;

  @Expose()
  session?: {
    token: string;
    expiresAt: Date;
  };
}

export class SignOutResponseDto extends BaseDto {
  @Expose()
  success!: boolean;
}

export class GetSessionResponseDto extends BaseDto {
  @Expose()
  user?: AuthUserDto;

  @Expose()
  session?: {
    token: string;
    expiresAt: Date;
  };
}
