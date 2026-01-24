import type { DtoConstructor } from '@/shared/dto/base';
import { isDtoClass } from '@/shared/dto/base';
import type { Request, Response } from 'express';

export const PARAM_METADATA_KEY = Symbol('param_metadata');

export enum ParamType {
  BODY = 'body',
  QUERY = 'query',
  PARAM = 'param',
  REQUEST = 'request',
  RESPONSE = 'response',
  CONFIG = 'config',
  INPUT = 'input',
}

export interface ParamMetadata {
  index: number;
  type: ParamType;
  dtoClass?: DtoConstructor;
  propertyKey?: string;
}

function createParamDecorator<T>(
  type: ParamType,
  dtoClass?: DtoConstructor<T>,
  propertyKey?: string,
) {
  return function (
    target: object,
    methodName: string | symbol,
    parameterIndex: number,
  ) {
    const existingParams: ParamMetadata[] =
      Reflect.getMetadata(PARAM_METADATA_KEY, target, methodName) || [];

    let resolvedDtoClass = dtoClass;
    if (!resolvedDtoClass && type !== ParamType.PARAM) {
      const paramTypes = Reflect.getMetadata(
        'design:paramtypes',
        target,
        methodName,
      );
      if (paramTypes && paramTypes[parameterIndex]) {
        const paramType = paramTypes[parameterIndex];
        if (isDtoClass(paramType)) {
          resolvedDtoClass = paramType;
        }
      }
    }

    existingParams.push({
      index: parameterIndex,
      type,
      dtoClass: resolvedDtoClass as DtoConstructor,
      propertyKey,
    });

    Reflect.defineMetadata(
      PARAM_METADATA_KEY,
      existingParams,
      target,
      methodName,
    );
  };
}

export function body<T>(dtoClass?: DtoConstructor<T>) {
  return createParamDecorator(ParamType.BODY, dtoClass);
}

export function query<T>(dtoClass?: DtoConstructor<T>) {
  return createParamDecorator(ParamType.QUERY, dtoClass);
}

export function param<T>(propertyKeyOrDto?: string | DtoConstructor<T>) {
  if (typeof propertyKeyOrDto === 'string') {
    return createParamDecorator(ParamType.PARAM, undefined, propertyKeyOrDto);
  }
  return createParamDecorator(ParamType.PARAM, propertyKeyOrDto);
}

export function request() {
  return createParamDecorator(ParamType.REQUEST);
}

export function response() {
  return createParamDecorator(ParamType.RESPONSE);
}

export function config() {
  return createParamDecorator(ParamType.CONFIG);
}

export function input() {
  return createParamDecorator(ParamType.INPUT);
}

export async function extractParams(
  target: any,
  methodName: string | symbol,
  req: Request,
  res: Response,
): Promise<any[]> {
  const paramMetadata: ParamMetadata[] =
    Reflect.getMetadata(PARAM_METADATA_KEY, target, methodName) || [];

  const params: any[] = [];

  for (const meta of paramMetadata) {
    let value: any;

    switch (meta.type) {
      case ParamType.BODY:
        if (meta.dtoClass) {
          value = await meta.dtoClass.validate(req.body);
        } else {
          value = req.body;
        }
        break;

      case ParamType.QUERY:
        if (meta.dtoClass) {
          value = await meta.dtoClass.validate(req.query);
        } else {
          value = req.query;
        }
        break;

      case ParamType.PARAM:
        if (meta.dtoClass) {
          value = await meta.dtoClass.validate(req.params);
        } else if (meta.propertyKey) {
          value = req.params[meta.propertyKey];
        } else {
          value = req.params;
        }
        break;

      case ParamType.REQUEST:
        value = req;
        break;

      case ParamType.RESPONSE:
        value = res;
        break;

      default:
        value = undefined;
    }

    params[meta.index] = value;
  }

  return params;
}
