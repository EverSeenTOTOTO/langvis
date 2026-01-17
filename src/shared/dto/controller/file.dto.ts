import { BaseDto } from '../base';
import { Expose } from 'class-transformer';
import { IsString, IsNotEmpty } from 'class-validator';

export class FileParamsDto extends BaseDto {
  @Expose({ name: '0' })
  @IsString()
  @IsNotEmpty()
  filename!: string;
}
