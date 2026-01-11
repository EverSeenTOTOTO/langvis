import { Expose } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { BaseDto } from '../base';

export class ChatAgentConfigDto extends BaseDto {
  @Expose()
  @IsString()
  @IsOptional()
  model?: {
    code?: string;
    temperature?: number;
  };
}

export class ChatAgentResponseDto extends BaseDto {
  @Expose()
  @IsString()
  content!: string;
}
