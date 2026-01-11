import { Expose } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { BaseDto } from '../base';

export class DateTimeInputDto extends BaseDto {
  @Expose()
  @IsString()
  @IsOptional()
  timezone?: string;

  @Expose()
  @IsString()
  @IsOptional()
  format?: string;
}

export class DateTimeOutputDto extends BaseDto {
  @Expose()
  @IsString()
  datetime!: string;
}
