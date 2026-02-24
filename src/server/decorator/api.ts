import { ValidationException } from '@/shared/dto/base';
import { getOwnPropertyNames } from '@/shared/utils';
import { Express, NextFunction, Request, Response } from 'express';
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
}

export function api(path: string, options?: ApiOptions): PropertyDecorator {
  return function apiDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(metaDataKey, { path, options }, target, propertyKey);
  };
}

function getFileParams(
  target: any,
  methodName: string | symbol,
): ParamMetadata[] {
  const paramMetadata: ParamMetadata[] =
    Reflect.getMetadata(PARAM_METADATA_KEY, target, methodName) || [];
  return paramMetadata.filter(
    meta => meta.type === ParamType.FILE || meta.type === ParamType.FILES,
  );
}

function createUploadMiddleware(
  fileParams: ParamMetadata[],
): ((req: Request, res: Response, next: NextFunction) => void) | null {
  if (fileParams.length === 0) return null;

  // Single FILE param -> use upload.single()
  if (fileParams.length === 1 && fileParams[0].type === ParamType.FILE) {
    const options = fileParams[0].config as multer.Options | undefined;
    const storage = options?.storage ?? multer.memoryStorage();
    const upload = multer({ ...options, storage });
    return upload.single(fileParams[0].propertyKey || 'file');
  }

  const fields: { name: string; maxCount?: number }[] = [];
  let options: multer.Options | undefined;

  for (const param of fileParams) {
    const config = param.config as
      | ({ maxCount?: number } & multer.Options)
      | undefined;
    fields.push({
      name:
        param.propertyKey || (param.type === ParamType.FILE ? 'file' : 'files'),
      maxCount:
        param.type === ParamType.FILE
          ? (config?.maxCount ?? 1)
          : config?.maxCount,
    });
    if (config) options = config;
  }

  const storage = options?.storage ?? multer.memoryStorage();
  const upload = multer({ ...options, storage });
  return upload.fields(fields);
}

function wrapUploadMiddleware(
  uploadMiddleware: (req: Request, res: Response, next: NextFunction) => void,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    uploadMiddleware(req, res, err => {
      if (err?.name === 'MulterError') {
        req.log?.warn('Multer error:', err.message);
        res.status(400).json({
          error: 'File upload failed',
          details: err.message,
        });
        return;
      }
      next(err);
    });
  };
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
        (req: Request, res: Response, next: NextFunction) => void
      > = [];

      const fileParams = getFileParams(instance, prop);
      const uploadMiddleware = createUploadMiddleware(fileParams);

      if (uploadMiddleware) {
        middlewares.push(wrapUploadMiddleware(uploadMiddleware));
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

          req.log?.error(e.stack || e.message);
          return res.status(500).json({
            error: e.message || 'Internal Server Error',
          });
        }
      });
    }
  });

  return instance;
}
