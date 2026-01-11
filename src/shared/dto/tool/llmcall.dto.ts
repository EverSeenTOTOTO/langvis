import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { BaseDto } from '../base';

enum MessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

export class LlmMessageDto extends BaseDto {
  @Expose()
  @IsEnum(MessageRole)
  @IsNotEmpty()
  role!: 'system' | 'user' | 'assistant';

  @Expose()
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class LlmCallInputDto extends BaseDto {
  @Expose()
  @IsString()
  @IsOptional()
  model?: string;

  @Expose()
  @Type(() => LlmMessageDto)
  @ValidateNested({ each: true })
  @IsArray()
  @IsNotEmpty()
  messages!: LlmMessageDto[];

  @Expose()
  @IsNumber()
  @Min(0)
  @Max(2)
  @IsOptional()
  temperature?: number;

  @Expose()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  stop?: string[];
}

export class LlmCallOutputDto extends BaseDto {
  @Expose()
  content!: string;

  @Expose()
  @IsString()
  @IsOptional()
  finishReason?: string;
}
