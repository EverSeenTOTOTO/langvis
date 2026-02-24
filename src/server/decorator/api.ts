import { ValidationException } from '@/shared/dto/base';
import { getOwnPropertyNames } from '@/shared/utils';
import { Express, Request, Response } from 'express';
import multer from 'multer';
import {
  extractParams,
  ParamMetadata,
  ParamType,
  PARAM_METADATA_KEY,
} from './param';

const metaDataKey = Symbol('server_api');

export interface ApiOptions {
  method?: 'get' | 'post' | 'put' | 'delete' | 'patch';
  /**
   * Multer file upload configuration
   * @example
   * // Single file
   * upload: { single: 'avatar' }
   * // Multiple files with same field name
   * upload: { array: { name: 'photos', maxCount: 5 } }
   * // Multiple fields
   * upload: { fields: [{ name: 'avatar', maxCount: 1 }, { name: 'gallery', maxCount: 8 }] }
   * // Any file
   * upload: { any: true }
   */
  upload?: {
    single?: string;
    array?: { name: string; maxCount?: number };
    fields?: { name: string; maxCount?: number }[];
    any?: boolean;
    options?: multer.Options;
  };
}

export function api(path: string, options?: ApiOptions): PropertyDecorator {
  return function apiDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(metaDataKey, { path, options }, target, propertyKey);
  };
}

function createMulterMiddleware(
  uploadConfig: NonNullable<ApiOptions['upload']>,
) {
  const storage = uploadConfig.options?.storage ?? multer.memoryStorage();
  const upload = multer({ ...uploadConfig.options, storage });

  if (uploadConfig.single) {
    return upload.single(uploadConfig.single);
  }
  if (uploadConfig.array) {
    return upload.array(uploadConfig.array.name, uploadConfig.array.maxCount);
  }
  if (uploadConfig.fields) {
    return upload.fields(uploadConfig.fields);
  }
  if (uploadConfig.any) {
    return upload.any();
  }
  return upload.none();
}

function hasFileParams(target: any, methodName: string | symbol): boolean {
  const paramMetadata: ParamMetadata[] =
    Reflect.getMetadata(PARAM_METADATA_KEY, target, methodName) || [];
  return paramMetadata.some(
    meta => meta.type === ParamType.FILE || meta.type === ParamType.FILES,
  );
}

export default function <T extends Record<string, any>>(
  instance: T,
  namespace: string,
  app: Express,
) {
  getOwnPropertyNames(instance).forEach(prop => {
    const config = Reflect.getMetadata(metaDataKey, instance, prop);

    if (config) {
      const handle = instance[prop].bind(instance);
      const path = `${namespace}${config.path}`;
      const method = (config.options?.method as 'get') || 'get';

      const middlewares: Array<
        (req: Request, res: Response, next: () => void) => void
      > = [];

      if (config.options?.upload) {
        middlewares.push(createMulterMiddleware(config.options.upload));
      } else if (hasFileParams(instance, prop)) {
        middlewares.push(multer().none());
      }

      void app[method](path, ...middlewares, async (req, res) => {
        try {
          const params = await extractParams(instance, prop, req, res);
          return await handle(...params);
        } catch (err) {
          const e = err as Error;

          if (e instanceof ValidationException) {
            req.log?.warn('Validation error:', e.toJSON());
            return res.status(400).json({
              error: 'Validation failed',
              details: e.toJSON().errors,
            });
          }

          if (e instanceof multer.MulterError) {
            req.log?.warn('Multer error:', e.message);
            return res.status(400).json({
              error: 'File upload failed',
              details: e.message,
            });
          }

          req.log?.error(e.stack || e.message);
          return res.status(500).json({
            error: (e as Error).message || 'Internal Server Error',
          });
        }
      });
    }
  });

  return instance;
}
