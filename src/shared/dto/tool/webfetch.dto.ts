import { Expose } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { BaseDto } from '../base';

export class WebFetchInputDto extends BaseDto {
  @Expose()
  @IsUrl()
  @IsNotEmpty()
  url!: string;

  @Expose()
  @IsNumber()
  @Min(1000)
  @Max(120000)
  @IsOptional()
  timeout?: number;
}

export class WebFetchOutputDto extends BaseDto {
  @Expose()
  @IsString()
  title!: string;

  @Expose()
  @IsString()
  textContent!: string;

  @Expose()
  @IsString()
  excerpt!: string;

  @Expose()
  @IsString()
  @IsOptional()
  byline?: string | null;

  @Expose()
  @IsString()
  @IsOptional()
  siteName?: string | null;

  @Expose()
  @IsUrl()
  url!: string;
}
