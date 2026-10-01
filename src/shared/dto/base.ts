import { JSONSchemaType } from 'ajv';
import { ajv, getValidator } from '@/server/utils/schemaValidator';

export class ValidationException extends Error {
  constructor(
    public errors: string,
    message = 'Validation failed',
  ) {
    super(message);
    this.name = 'ValidationException';
  }

  toJSON() {
    return {
      message: this.message,
      errors: this.errors,
    };
  }
}

export const DTO_SCHEMA_KEY = Symbol.for('dto:schema');

export interface DtoConstructor<T = any> {
  new (): T;
  validate(plain: unknown): Promise<T>;
  transform(plain: unknown): T;
}

export function isDtoClass(target: any): target is DtoConstructor {
  return (
    typeof target === 'function' && Reflect.hasMetadata(DTO_SCHEMA_KEY, target)
  );
}

export abstract class BaseDto {
  static validate: (plain: unknown) => Promise<any>;
  static transform: (plain: unknown) => any;
}

export function dto<T extends object>(schema: JSONSchemaType<T>) {
  return function <C extends new () => T>(Target: C): C & DtoConstructor<T> {
    Reflect.defineMetadata(DTO_SCHEMA_KEY, schema, Target);

    const EnhancedClass = Target as C & DtoConstructor<T>;

    EnhancedClass.validate = async function (plain: unknown): Promise<T> {
      const validator = getValidator(schema);
      const data = structuredClone(plain);
      if (validator(data)) {
        // 返回 plain 对象而非类实例——下游校验器（如 better-auth 的 zod）
        // 拒收非 plain 对象；DTO 是纯数据袋，实例化无收益。
        return data as T;
      }
      throw new ValidationException(ajv.errorsText(validator.errors));
    };

    EnhancedClass.transform = function (plain: unknown): T {
      const data = structuredClone(plain);
      const validator = getValidator(schema);
      validator(data);
      return data as T;
    };

    return EnhancedClass;
  };
}
