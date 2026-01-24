import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  Dto,
  BaseDto,
  isDtoClass,
  ValidationException,
  DTO_SCHEMA_KEY,
} from '@/shared/dto/base';

interface TestUser {
  name: string;
  age: number;
  email?: string;
}

@Dto<TestUser>({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 0 },
    email: { type: 'string', format: 'email', nullable: true },
  },
  required: ['name', 'age'],
  additionalProperties: false,
})
class TestUserDto extends BaseDto implements TestUser {
  name!: string;
  age!: number;
  email?: string;
}

interface EmptyRequest {}

@Dto<EmptyRequest>({
  type: 'object',
  additionalProperties: false,
})
class EmptyRequestDto extends BaseDto implements EmptyRequest {}

class NotADto {}

describe('Dto decorator', () => {
  describe('validate', () => {
    it('should validate and return instance with valid data', async () => {
      const data = { name: 'John', age: 25 };
      const result = await TestUserDto.validate(data);

      expect(result).toBeInstanceOf(TestUserDto);
      expect(result.name).toBe('John');
      expect(result.age).toBe(25);
    });

    it('should validate with optional fields', async () => {
      const data = { name: 'John', age: 25, email: 'john@example.com' };
      const result = await TestUserDto.validate(data);

      expect(result.email).toBe('john@example.com');
    });

    it('should throw ValidationException for missing required field', async () => {
      const data = { name: 'John' };

      await expect(TestUserDto.validate(data)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should throw ValidationException for invalid type', async () => {
      const data = { name: 'John', age: 'not a number' };

      await expect(TestUserDto.validate(data)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should throw ValidationException for constraint violation', async () => {
      const data = { name: '', age: 25 };

      await expect(TestUserDto.validate(data)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should throw ValidationException for additional properties', async () => {
      const data = { name: 'John', age: 25, extra: 'field' };

      await expect(TestUserDto.validate(data)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should not mutate original data', async () => {
      const data = { name: 'John', age: 25 };
      const original = { ...data };

      await TestUserDto.validate(data);

      expect(data).toEqual(original);
    });

    it('should validate empty object dto', async () => {
      const result = await EmptyRequestDto.validate({});

      expect(result).toBeInstanceOf(EmptyRequestDto);
    });
  });

  describe('transform', () => {
    it('should transform valid data without throwing', () => {
      const data = { name: 'John', age: 25 };
      const result = TestUserDto.transform(data);

      expect(result).toBeInstanceOf(TestUserDto);
      expect(result.name).toBe('John');
      expect(result.age).toBe(25);
    });

    it('should still return instance even with invalid data', () => {
      const data = { name: 'John' };
      const result = TestUserDto.transform(data);

      expect(result).toBeInstanceOf(TestUserDto);
      expect(result.name).toBe('John');
      expect(result.age).toBeUndefined();
    });

    it('should not mutate original data', () => {
      const data = { name: 'John', age: 25 };
      const original = { ...data };

      TestUserDto.transform(data);

      expect(data).toEqual(original);
    });
  });

  describe('metadata', () => {
    it('should store schema in metadata', () => {
      const schema = Reflect.getMetadata(DTO_SCHEMA_KEY, TestUserDto);

      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties.name).toBeDefined();
    });
  });
});

describe('isDtoClass', () => {
  it('should return true for class decorated with @Dto', () => {
    expect(isDtoClass(TestUserDto)).toBe(true);
  });

  it('should return false for regular class', () => {
    expect(isDtoClass(NotADto)).toBe(false);
  });

  it('should return false for non-function values', () => {
    expect(isDtoClass({})).toBe(false);
    expect(isDtoClass(null)).toBe(false);
    expect(isDtoClass(undefined)).toBe(false);
    expect(isDtoClass('string')).toBe(false);
    expect(isDtoClass(123)).toBe(false);
  });
});

describe('ValidationException', () => {
  it('should create exception with error details', () => {
    const exception = new ValidationException('field is required');

    expect(exception.name).toBe('ValidationException');
    expect(exception.message).toBe('Validation failed');
    expect(exception.errors).toBe('field is required');
  });

  it('should create exception with custom message', () => {
    const exception = new ValidationException(
      'field is required',
      'Custom message',
    );

    expect(exception.message).toBe('Custom message');
  });

  it('should serialize to JSON correctly', () => {
    const exception = new ValidationException('field is required');
    const json = exception.toJSON();

    expect(json).toEqual({
      message: 'Validation failed',
      errors: 'field is required',
    });
  });
});
