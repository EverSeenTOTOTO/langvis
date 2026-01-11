import { BaseDto } from '@/shared/dto/base';
import type { ClassConstructor } from 'class-transformer';
import type { Request, Response } from 'express';

const PARAM_METADATA_KEY = Symbol('param_metadata');

export enum ParamType {
  BODY = 'body',
  QUERY = 'query',
  PARAM = 'param',
  REQUEST = 'request',
  RESPONSE = 'response',
}

export interface ParamMetadata {
  index: number;
  type: ParamType;
  dtoClass?: ClassConstructor<BaseDto>;
  propertyKey?: string;
}

function createParamDecorator(
  type: ParamType,
  dtoClass?: ClassConstructor<BaseDto>,
  propertyKey?: string,
) {
  return function (
    target: any,
    methodName: string | symbol,
    parameterIndex: number,
  ) {
    const existingParams: ParamMetadata[] =
      Reflect.getMetadata(PARAM_METADATA_KEY, target, methodName) || [];

    let finalDtoClass = dtoClass;

    if (
      !finalDtoClass &&
      (type === ParamType.BODY || type === ParamType.QUERY)
    ) {
      const paramTypes: any[] =
        Reflect.getMetadata('design:paramtypes', target, methodName) || [];
      const paramType = paramTypes[parameterIndex];

      if (paramType && paramType.prototype instanceof BaseDto) {
        finalDtoClass = paramType;
      }
    }

    existingParams.push({
      index: parameterIndex,
      type,
      dtoClass: finalDtoClass,
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

export function body<T extends BaseDto>(dtoClass?: ClassConstructor<T>) {
  return createParamDecorator(ParamType.BODY, dtoClass);
}

export function query<T extends BaseDto>(dtoClass?: ClassConstructor<T>) {
  return createParamDecorator(ParamType.QUERY, dtoClass);
}

export function param(propertyKey?: string) {
  return createParamDecorator(ParamType.PARAM, undefined, propertyKey);
}

export function request() {
  return createParamDecorator(ParamType.REQUEST);
}

export function response() {
  return createParamDecorator(ParamType.RESPONSE);
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
          value = await (meta.dtoClass as any).validate(req.body);
        } else {
          value = req.body;
        }
        break;

      case ParamType.QUERY:
        if (meta.dtoClass) {
          value = await (meta.dtoClass as any).validate(req.query);
        } else {
          value = req.query;
        }
        break;

      case ParamType.PARAM:
        if (meta.propertyKey) {
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
