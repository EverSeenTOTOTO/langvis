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

export const DTO_SCHEMA_KEY = Symbol('dto:schema');

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

export function Dto<T extends object>(schema: JSONSchemaType<T>) {
  return function <C extends new () => T>(Target: C): C & DtoConstructor<T> {
    Reflect.defineMetadata(DTO_SCHEMA_KEY, schema, Target);

    const EnhancedClass = Target as C & DtoConstructor<T>;

    EnhancedClass.validate = async function (plain: unknown): Promise<T> {
      const validator = getValidator(schema);
      const data = structuredClone(plain);
      if (validator(data)) {
        return Object.assign(new Target(), data) as T;
      }
      throw new ValidationException(ajv.errorsText(validator.errors));
    };

    EnhancedClass.transform = function (plain: unknown): T {
      const data = structuredClone(plain);
      const validator = getValidator(schema);
      validator(data);
      return Object.assign(new Target(), data) as T;
    };

    return EnhancedClass;
  };
}
