import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';
import { jsonrepair } from 'jsonrepair';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  useDefaults: true,
  coerceTypes: true,
});

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

export function coerceJsonStringFields(
  schema: unknown,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const props = (
    schema as { properties?: Record<string, { type?: string }> } | null
  )?.properties;
  if (!props) return null;
  let changed = false;
  const out = { ...data };
  for (const [key, prop] of Object.entries(props)) {
    const want = prop?.type;
    if (
      (want === 'object' || want === 'array') &&
      typeof out[key] === 'string'
    ) {
      const parsed = looseJsonParse(out[key]);
      if (
        parsed !== undefined &&
        (want === 'array'
          ? Array.isArray(parsed)
          : parsed !== null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed))
      ) {
        out[key] = parsed;
        changed = true;
      }
    }
  }
  return changed ? out : null;
}

function looseJsonParse(s: string): unknown {
  // JSON.parse 已失败的兜底：剥 fence/引号后形似 JSON 才 jsonrepair，再由 ajv 二次校验。
  const candidate = stripWrap(s.trim());
  if (candidate[0] !== '{' && candidate[0] !== '[') return undefined;
  try {
    return JSON.parse(jsonrepair(candidate));
  } catch {
    return undefined;
  }
}

function stripWrap(s: string): string {
  let v = s;
  const fence = v.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fence) v = fence[1]!.trim();
  if (v.length >= 2 && v[0] === '"' && v.at(-1) === '"')
    v = v.slice(1, -1).trim();
  return v;
}

export { ajv };
