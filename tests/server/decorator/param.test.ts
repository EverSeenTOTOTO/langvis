import {
  body,
  extractParams,
  param,
  PARAM_METADATA_KEY,
  ParamType,
  query,
  request,
  response,
} from '@/server/decorator/param';
import { BaseDto, Dto } from '@/shared/dto/base';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface TestInput {
  name: string;
  age: number;
}

@Dto<TestInput>({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 0 },
  },
  required: ['name', 'age'],
  additionalProperties: false,
})
class TestInputDto extends BaseDto implements TestInput {
  name!: string;
  age!: number;
}

interface QueryParams {
  page: number;
  limit: number;
}

@Dto<QueryParams>({
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  required: ['page', 'limit'],
  additionalProperties: false,
})
class QueryParamsDto extends BaseDto implements QueryParams {
  page!: number;
  limit!: number;
}

describe('param decorators', () => {
  describe('body decorator', () => {
    it('should auto-infer DTO class from parameter type', () => {
      class TestController {
        async create(@body() dto: TestInputDto) {
          return dto;
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'create',
      );

      expect(metadata).toHaveLength(1);
      expect(metadata[0].type).toBe(ParamType.BODY);
      expect(metadata[0].dtoClass).toBe(TestInputDto);
    });

    it('should use explicitly provided DTO class', () => {
      class TestController {
        async create(@body(TestInputDto) dto: any) {
          return dto;
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'create',
      );

      expect(metadata[0].dtoClass).toBe(TestInputDto);
    });

    it('should not set dtoClass for non-DTO parameter type', () => {
      class TestController {
        async create(@body() data: Record<string, any>) {
          return data;
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'create',
      );

      expect(metadata[0].dtoClass).toBeUndefined();
    });
  });

  describe('query decorator', () => {
    it('should auto-infer DTO class from parameter type', () => {
      class TestController {
        async list(@query() params: QueryParamsDto) {
          return params;
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'list',
      );

      expect(metadata[0].type).toBe(ParamType.QUERY);
      expect(metadata[0].dtoClass).toBe(QueryParamsDto);
    });
  });

  describe('param decorator', () => {
    it('should extract single param by key', () => {
      class TestController {
        async getById(@param('id') id: string) {
          return id;
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'getById',
      );

      expect(metadata[0].type).toBe(ParamType.PARAM);
      expect(metadata[0].propertyKey).toBe('id');
      expect(metadata[0].dtoClass).toBeUndefined();
    });

    it('should not auto-infer DTO for param decorator', () => {
      class TestController {
        async getById(@param() params: TestInputDto) {
          return params;
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'getById',
      );

      expect(metadata[0].dtoClass).toBeUndefined();
    });
  });

  describe('request and response decorators', () => {
    it('should mark parameter as request type', () => {
      class TestController {
        async handle(@request() req: Request) {
          return req;
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'handle',
      );

      expect(metadata[0].type).toBe(ParamType.REQUEST);
    });

    it('should mark parameter as response type', () => {
      class TestController {
        async handle(@response() res: Response) {
          return res;
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'handle',
      );

      expect(metadata[0].type).toBe(ParamType.RESPONSE);
    });
  });

  describe('multiple decorators', () => {
    it('should handle multiple parameters with different decorators', () => {
      class TestController {
        async update(
          @param('id') id: string,
          @body() dto: TestInputDto,
          @response() res: Response,
        ) {
          return { id, dto, res };
        }
      }

      const metadata = Reflect.getMetadata(
        PARAM_METADATA_KEY,
        TestController.prototype,
        'update',
      );

      expect(metadata).toHaveLength(3);

      const paramMeta = metadata.find((m: any) => m.type === ParamType.PARAM);
      const bodyMeta = metadata.find((m: any) => m.type === ParamType.BODY);
      const resMeta = metadata.find((m: any) => m.type === ParamType.RESPONSE);

      expect(paramMeta.index).toBe(0);
      expect(paramMeta.propertyKey).toBe('id');

      expect(bodyMeta.index).toBe(1);
      expect(bodyMeta.dtoClass).toBe(TestInputDto);

      expect(resMeta.index).toBe(2);
    });
  });
});

describe('extractParams', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockReq = {
      body: { name: 'John', age: 25 },
      query: { page: '1', limit: '10' },
      params: { id: '123' },
    };
    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
  });

  it('should extract and validate body parameter', async () => {
    class TestController {
      async create(@body() dto: TestInputDto) {
        return dto;
      }
    }

    const controller = new TestController();
    const params = await extractParams(
      controller,
      'create',
      mockReq as Request,
      mockRes as Response,
    );

    expect(params[0]).toBeInstanceOf(TestInputDto);
    expect(params[0].name).toBe('John');
    expect(params[0].age).toBe(25);
  });

  it('should throw ValidationException for invalid body', async () => {
    class TestController {
      async create(@body() dto: TestInputDto) {
        return dto;
      }
    }

    mockReq.body = { name: 'John' };

    const controller = new TestController();

    await expect(
      extractParams(
        controller,
        'create',
        mockReq as Request,
        mockRes as Response,
      ),
    ).rejects.toThrow();
  });

  it('should extract raw body when no DTO class', async () => {
    class TestController {
      async create(@body() data: any) {
        return data;
      }
    }

    const controller = new TestController();
    const params = await extractParams(
      controller,
      'create',
      mockReq as Request,
      mockRes as Response,
    );

    expect(params[0]).toEqual({ name: 'John', age: 25 });
  });

  it('should extract param by key', async () => {
    class TestController {
      async getById(@param('id') id: string) {
        return id;
      }
    }

    const controller = new TestController();
    const params = await extractParams(
      controller,
      'getById',
      mockReq as Request,
      mockRes as Response,
    );

    expect(params[0]).toBe('123');
  });

  it('should extract request and response objects', async () => {
    class TestController {
      async handle(@request() req: Request, @response() res: Response) {
        return { req, res };
      }
    }

    const controller = new TestController();
    const params = await extractParams(
      controller,
      'handle',
      mockReq as Request,
      mockRes as Response,
    );

    expect(params[0]).toBe(mockReq);
    expect(params[1]).toBe(mockRes);
  });

  it('should extract multiple parameters in correct order', async () => {
    class TestController {
      async update(
        @param('id') id: string,
        @body() dto: TestInputDto,
        @response() res: Response,
      ) {
        return { id, dto, res };
      }
    }

    const controller = new TestController();
    const params = await extractParams(
      controller,
      'update',
      mockReq as Request,
      mockRes as Response,
    );

    expect(params[0]).toBe('123');
    expect(params[1]).toBeInstanceOf(TestInputDto);
    expect(params[2]).toBe(mockRes);
  });
});
