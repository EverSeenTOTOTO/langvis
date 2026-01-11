import { Role } from '@/shared/entities/Message';
import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { BaseDto } from '../base';

export class ConversationConfigDto extends BaseDto {
  @Expose()
  @IsString()
  @IsNotEmpty()
  agent!: string;

  @Expose()
  model?: {
    code?: string;
    temperature?: number;
  };
}

export class MessageDto extends BaseDto {
  @Expose()
  @IsUUID()
  id!: string;

  @Expose()
  @IsEnum(Role)
  role!: Role;

  @Expose()
  @IsString()
  content!: string;

  @Expose()
  @IsObject()
  @IsOptional()
  meta?: Record<string, any> | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  @IsUUID()
  conversationId!: string;
}

export class ConversationDto extends BaseDto {
  @Expose()
  @IsUUID()
  id!: string;

  @Expose()
  @IsString()
  name!: string;

  @Expose()
  @Type(() => ConversationConfigDto)
  @ValidateNested()
  @IsOptional()
  config?: ConversationConfigDto | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  @Type(() => MessageDto)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  messages?: MessageDto[];
}

export class CreateConversationRequestDto extends BaseDto {
  @Expose()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Expose()
  @Type(() => ConversationConfigDto)
  @ValidateNested()
  @IsOptional()
  config?: ConversationConfigDto;
}

export class CreateConversationResponseDto extends ConversationDto {}

export class GetAllConversationsRequestDto extends BaseDto {}

export class GetAllConversationsResponseDto extends BaseDto {
  @Expose()
  @Type(() => ConversationDto)
  @ValidateNested({ each: true })
  @IsArray()
  conversations!: ConversationDto[];
}

export class GetConversationByIdRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  id!: string;
}

export class GetConversationByIdResponseDto extends ConversationDto {}

export class UpdateConversationRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  id!: string;

  @Expose()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Expose()
  @Type(() => ConversationConfigDto)
  @ValidateNested()
  @IsOptional()
  config?: ConversationConfigDto;
}

export class UpdateConversationResponseDto extends ConversationDto {}

export class DeleteConversationRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  id!: string;
}

export class DeleteConversationResponseDto extends BaseDto {
  @Expose()
  success!: boolean;
}

export class AddMessageToConversationRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  id!: string;

  @Expose()
  @IsEnum(Role)
  @IsNotEmpty()
  role!: Role;

  @Expose()
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class AddMessageToConversationResponseDto extends MessageDto {}

export class GetMessagesByConversationIdRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  id!: string;
}

export class GetMessagesByConversationIdResponseDto extends BaseDto {
  @Expose()
  @Type(() => MessageDto)
  @ValidateNested({ each: true })
  @IsArray()
  messages!: MessageDto[];
}

export class BatchDeleteMessagesInConversationRequestDto extends BaseDto {
  @Expose()
  @IsUUID()
  @IsNotEmpty()
  id!: string;

  @Expose()
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsNotEmpty()
  messageIds!: string[];
}

export class BatchDeleteMessagesInConversationResponseDto extends BaseDto {
  @Expose()
  @IsUUID()
  id!: string;
}
