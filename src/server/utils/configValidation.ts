import { ConfigItem } from '@/shared/types';
import {
  isArray,
  isNumber,
  isString,
  isBoolean,
  isPlainObject,
  isObject,
} from 'lodash-es';

export class ConfigValidationError extends Error {
  constructor(
    msg: string,
    public path: string,
  ) {
    super(`${path}: ${msg}`);
    this.name = 'ConfigValidationError';
  }
}

const getOptionValue = (opt: any): string | number => {
  if (isObject(opt) && 'value' in opt) {
    return (opt as any).value;
  }
  return opt;
};

export const validateConfig = (
  schema: Record<string, ConfigItem> | undefined,
  input: Record<string, any> | undefined,
  pathPrefix = '',
): Record<string, any> => {
  if (!schema) return input || {};

  const result: Record<string, any> = { ...input };

  for (const [key, config] of Object.entries(schema)) {
    const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    let value = result[key];

    // Handle initial value
    if (
      config.type !== 'group' &&
      value === undefined &&
      config.initialValue !== undefined
    ) {
      value = config.initialValue;
      result[key] = value;
    }

    // Check required
    if (
      config.type !== 'group' &&
      config.required &&
      (value === undefined || value === null || value === '')
    ) {
      throw new ConfigValidationError('Field is required', currentPath);
    }

    // Skip validation if optional and empty (and not a group)
    if (value === undefined || value === null) {
      continue;
    }

    switch (config.type) {
      case 'text':
        if (!isString(value)) {
          throw new ConfigValidationError('Expected string', currentPath);
        }
        break;

      case 'number':
        if (!isNumber(value)) {
          // Try to parse if it's a string (e.g. from query params)
          if (isString(value) && !isNaN(Number(value))) {
            value = Number(value);
            result[key] = value;
          } else {
            throw new ConfigValidationError('Expected number', currentPath);
          }
        }
        if (config.min !== undefined && value < config.min) {
          throw new ConfigValidationError(
            `Value must be >= ${config.min}`,
            currentPath,
          );
        }
        if (config.max !== undefined && value > config.max) {
          throw new ConfigValidationError(
            `Value must be <= ${config.max}`,
            currentPath,
          );
        }
        break;

      case 'switch':
        if (!isBoolean(value)) {
          if (value === 'true') {
            result[key] = true;
          } else if (value === 'false') {
            result[key] = false;
          } else {
            throw new ConfigValidationError('Expected boolean', currentPath);
          }
        }
        break;

      case 'select':
      case 'radio-group':
        // Check if value is in options
        if (config.options) {
          const validValues = config.options.map(getOptionValue);
          if (config.type === 'select' && config.mode === 'multiple') {
            if (!isArray(value)) {
              throw new ConfigValidationError(
                'Expected array for multiple select',
                currentPath,
              );
            }
            for (const v of value) {
              if (!validValues.includes(v)) {
                throw new ConfigValidationError(
                  `Invalid option: ${v}`,
                  currentPath,
                );
              }
            }
          } else {
            if (!validValues.includes(value)) {
              throw new ConfigValidationError(
                `Invalid option: ${value}`,
                currentPath,
              );
            }
          }
        }
        break;

      case 'checkbox-group':
        if (!isArray(value)) {
          throw new ConfigValidationError('Expected array', currentPath);
        }
        if (config.options) {
          const validValues = config.options.map(getOptionValue);
          for (const v of value) {
            if (!validValues.includes(v)) {
              throw new ConfigValidationError(
                `Invalid option: ${v}`,
                currentPath,
              );
            }
          }
        }
        break;

      case 'group':
        if (!isPlainObject(value)) {
          throw new ConfigValidationError('Expected object', currentPath);
        }
        result[key] = validateConfig(config.children, value, currentPath);
        break;
    }
  }

  return result;
};
