import { Role } from '@/shared/entities/Message';
import { Expose } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { BaseDto } from '../base';

export class InitSSERequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  conversationId!: string;
}

export class CancelChatRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  conversationId!: string;

  @Expose()
  @IsUUID()
  @IsNotEmpty()
  messageId!: string;

  @Expose()
  @IsString()
  @IsOptional()
  reason?: string;
}

export class CancelChatResponseDto extends BaseDto {
  @Expose()
  success!: boolean;
}

export class StartChatRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  conversationId!: string;

  @Expose()
  @IsEnum(Role)
  @IsNotEmpty()
  role!: Role;

  @Expose()
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class StartChatResponseDto extends BaseDto {
  @Expose()
  success!: boolean;
}
