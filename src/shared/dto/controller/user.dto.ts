import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { BaseDto } from '../base';

export class UserDto extends BaseDto {
  @Expose()
  @IsUUID()
  id!: string;

  @Expose()
  @IsString()
  name!: string;

  @Expose()
  @IsEmail()
  email!: string;

  @Expose()
  emailVerified!: boolean;

  @Expose()
  @IsString()
  @IsOptional()
  image?: string | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}

export class GetAllUsersRequestDto extends BaseDto {}

export class GetAllUsersResponseDto extends BaseDto {
  @Expose()
  @Type(() => UserDto)
  @ValidateNested({ each: true })
  @IsArray()
  users!: UserDto[];
}

export class GetUserByIdRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  id!: string;
}

export class GetUserByIdResponseDto extends UserDto {}

export class GetUserByEmailRequestDto extends BaseDto {
  @Expose()
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class GetUserByEmailResponseDto extends UserDto {}
