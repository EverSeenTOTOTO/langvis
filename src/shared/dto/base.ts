import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateOrReject, ValidationError } from 'class-validator';

export class ValidationException extends Error {
  constructor(
    public errors: ValidationError[],
    message = 'Validation failed',
  ) {
    super(message);
    this.name = 'ValidationException';
  }

  toJSON() {
    return {
      message: this.message,
      errors: this.errors.map(error => ({
        property: error.property,
        constraints: error.constraints,
        children: error.children,
      })),
    };
  }
}

export abstract class BaseDto {
  static async validate<T extends BaseDto>(
    this: ClassConstructor<T>,
    plain: unknown,
  ): Promise<T> {
    const instance = plainToInstance(this, plain, {
      excludeExtraneousValues: true,
      exposeDefaultValues: true,
    });

    try {
      await validateOrReject(instance, {
        whitelist: true,
        forbidNonWhitelisted: false,
        skipMissingProperties: false,
      });
    } catch (errors) {
      throw new ValidationException(errors as ValidationError[]);
    }

    return instance;
  }

  static transform<T extends BaseDto>(
    this: ClassConstructor<T>,
    plain: unknown,
  ): T {
    return plainToInstance(this, plain, {
      excludeExtraneousValues: true,
      exposeDefaultValues: true,
    });
  }
}
