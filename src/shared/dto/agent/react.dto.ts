import { Expose } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { BaseDto } from '../base';

export class ReActAgentConfigDto extends BaseDto {
  @Expose()
  @IsString()
  @IsOptional()
  model?: {
    code?: string;
    temperature?: number;
  };
}

export class ReActAgentResponseDto extends BaseDto {
  @Expose()
  @IsString()
  content!: string;

  @Expose()
  steps?: Array<{
    thought?: string;
    action?: {
      tool: string;
      input: Record<string, any>;
    };
    observation?: string;
    final_answer?: string;
  }>;
}
