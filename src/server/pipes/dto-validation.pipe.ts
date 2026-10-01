import { Injectable, PipeTransform } from '@nestjs/common';
import type { DtoConstructor } from '@/shared/dto/base';

// 显式 DTO 校验管道：包住既有 ajv validate()。逐参数声明——运行时无
// design:paramtypes，全局管道的 metatype 推断不可用。
@Injectable()
export class DtoValidationPipe<T>
  implements PipeTransform<unknown, Promise<T>>
{
  constructor(private readonly dtoClass: DtoConstructor<T>) {}

  transform(value: unknown): Promise<T> {
    return this.dtoClass.validate(value);
  }
}
