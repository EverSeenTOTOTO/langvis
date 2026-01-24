import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });

const validatorCache = new WeakMap<object, ValidateFunction>();

export function getValidator<T>(schema: JSONSchemaType<T>): ValidateFunction {
  let validator = validatorCache.get(schema);
  if (!validator) {
    validator = ajv.compile(schema);
    validatorCache.set(schema, validator);
  }
  return validator;
}

export function validate<T = unknown>(
  schema: JSONSchemaType<T>,
  data: unknown,
): { valid: true; data: T } | { valid: false; errors: string } {
  const validator = getValidator(schema);
  if (validator(data)) {
    return { valid: true, data: data as T };
  }
  return { valid: false, errors: ajv.errorsText(validator.errors) };
}

export function parse<T = unknown>(
  schema: JSONSchemaType<T>,
  data: unknown,
): T {
  const result = validate<T>(schema, data);
  if (!result.valid) {
    throw new Error(`Validation failed: ${result.errors}`);
  }
  return result.data;
}

export { ajv };
