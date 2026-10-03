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

// object/array 字段被模型传成字符串（fence/引号/双重编码）时按声明类型 JSON 还原；
// 递归进入 object 属性与 array 元素（如 document.metadata、chunks[i]），ajv 二次校验兜底。
export function coerceJsonStringFields(
  schema: unknown,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const recovered = coerceValue(schema, data);
  return recovered === data ? null : (recovered as Record<string, unknown>);
}

type LooseSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  items?: unknown;
};

function coerceValue(schema: unknown, value: unknown): unknown {
  const s = schema as LooseSchema | null;
  if (!s) return value;

  if (
    typeof value === 'string' &&
    (s.type === 'object' || s.type === 'array')
  ) {
    const parsed = looseJsonParse(value);
    if (parsed === undefined) return value;
    if (s.type === 'array' ? !Array.isArray(parsed) : Array.isArray(parsed))
      return value;
    return coerceValue(s, parsed);
  }

  if (s.type === 'object' && isPlainObject(value) && s.properties) {
    let changed = false;
    const out = { ...value };
    for (const [key, child] of Object.entries(out)) {
      const next = coerceValue(s.properties[key], child);
      if (next !== child) {
        out[key] = next;
        changed = true;
      }
    }
    return changed ? out : value;
  }

  if (s.type === 'array' && Array.isArray(value) && s.items) {
    const items = s.items as LooseSchema | LooseSchema[];
    const out = value.map((el, i) =>
      coerceValue(Array.isArray(items) ? items[i] : items, el),
    );
    return out.some((el, i) => el !== value[i]) ? out : value;
  }

  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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
