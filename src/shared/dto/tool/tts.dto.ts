import { Expose } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BaseDto } from '../base';

export class TextToSpeechInputDto extends BaseDto {
  @Expose()
  @IsString()
  @IsNotEmpty()
  text!: string;

  @Expose()
  @IsString()
  @IsOptional()
  reqId?: string;

  @Expose()
  @IsString()
  @IsOptional()
  voiceType?: string;

  @Expose()
  @IsString()
  @IsOptional()
  emotion?: string;

  @Expose()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  @IsOptional()
  speedRatio?: number;
}

export class TextToSpeechOutputDto extends BaseDto {
  @Expose()
  @IsString()
  filePath!: string;

  @Expose()
  @IsString()
  @IsOptional()
  url?: string;
}
