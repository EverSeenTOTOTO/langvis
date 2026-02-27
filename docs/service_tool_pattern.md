# ServiceTool 工厂方法设计文档

## 概述

ServiceTool 是一个工厂方法，用于快速创建将 Service 暴露给 Agent 的 Tool。每个 Service 的方法名、参数、说明各不相同，需要在 Tool 的 config 中显式声明。

## 动机

每个 Service 需要暴露给 Agent 的方法不同：

```typescript
// NoteService
create(data: CreateNoteDto): Promise<DocumentNote>
findByUrl(userId: string, url: string): Promise<DocumentNote | null>

// ConversationService
create(data: CreateConversationDto): Promise<Conversation>
findByUser(userId: string): Promise<Conversation[]>

// UserService
updateProfile(userId: string, data: UpdateProfileDto): Promise<User>
```

这些方法名、参数、返回值都不同，且需要为 Agent 提供清晰的说明文档。因此需要在每个 Tool 的 config 中**声明式定义**暴露的方法及其规格。

## 设计方案

### 工厂方法签名

```typescript
// src/server/core/tool/createServiceTool.ts

import { Tool, ToolConfig, ToolEvent } from '@/shared/types';
import { ExecutionContext } from '@/server/core/context';

/**
 * 方法规格定义
 */
interface MethodSpec<TInput = any, TOutput = any> {
  /** 方法说明，供 Agent 理解用途 */
  description: string;
  /** 入参 JSON Schema，用于验证和文档生成 */
  inputSchema: Record<string, any>;
  /** 出参 JSON Schema，用于文档生成（可选） */
  outputSchema?: Record<string, any>;
}

/**
 * Service 规格
 */
interface ServiceSpec<TService> {
  /** 关联的 Service 类 */
  service: new (...args: any[]) => TService;
  /** 暴露的方法定义 */
  methods: {
    [K in keyof TService]?: MethodSpec;
  };
}

/**
 * 创建 ServiceTool
 */
function createServiceTool<TService>(
  toolId: string,
  spec: ServiceSpec<TService>,
): {
  config: ToolConfig;
  implementation: new (...args: any[]) => Tool;
} {
  // 从 spec 生成 Tool 配置和实现
}
```

### 使用示例：NoteTool

```typescript
// src/server/core/tool/Note/config.ts
import { ToolIds } from '@/shared/constants';
import { createServiceTool } from '../createServiceTool';
import { NoteService } from '@/server/service/NoteService';

export const { config: NoteToolConfig, implementation: NoteTool } = createServiceTool(ToolIds.NOTE, {
  service: NoteService,

  methods: {
    create: {
      description: '创建一条新笔记',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '文章来源 URL' },
          title: { type: 'string', description: '文章标题' },
          category: {
            type: 'string',
            enum: ['tech_blog', 'academic_paper', 'social_news', ...],
            description: '文章类别'
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '关键词列表'
          },
          summary: {
            type: 'object',
            properties: {
              brief: { type: 'string', description: '一句话概要' },
              structured: { type: 'object', description: '结构化内容' },
            },
            description: '概要信息'
          },
          quotes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '原文引用' },
                context: { type: 'string', description: '引用原因' },
                importance: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
            },
            description: '重要引用列表',
          },
          rawContent: { type: 'string', description: '原始文本内容' },
        },
        required: ['title', 'category', 'keywords', 'summary', 'rawContent'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '笔记 ID' },
          title: { type: 'string' },
          category: { type: 'string' },
          createdAt: { type: 'string' },
        },
        description: '创建成功的笔记对象',
      },
    },

    read: {
      description: '根据 ID 读取笔记详情',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '笔记 ID' },
        },
        required: ['id'],
      },
      outputSchema: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          category: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          summary: { type: 'object' },
          quotes: { type: 'array' },
          rawContent: { type: 'string' },
        },
        description: '笔记对象，不存在时返回 null',
      },
    },

    update: {
      description: '更新已有笔记',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '笔记 ID' },
          title: { type: 'string', description: '新标题（可选）' },
          category: { type: 'string', description: '新类别（可选）' },
          keywords: { type: 'array', items: { type: 'string' }, description: '新关键词（可选）' },
          summary: { type: 'object', description: '新概要（可选）' },
          quotes: { type: 'array', description: '新引用列表（可选）' },
          extensions: { type: 'array', description: '新引申话题（可选）' },
        },
        required: ['id'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          updatedAt: { type: 'string' },
        },
        description: '更新后的笔记对象',
      },
    },

    delete: {
      description: '删除笔记',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '笔记 ID' },
        },
        required: ['id'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
        },
        description: '删除成功返回 { success: true }',
      },
    },

    findByUrl: {
      description: '根据 URL 查找是否已有历史笔记，用于去重',
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: '用户 ID' },
          url: { type: 'string', description: '要查询的 URL' },
        },
        required: ['userId', 'url'],
      },
      outputSchema: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string', description: '笔记 ID' },
          title: { type: 'string', description: '文章标题' },
          category: { type: 'string', description: '文章类别' },
        },
        description: '找到的笔记对象，不存在返回 null',
      },
    },

    list: {
      description: '查询笔记列表，支持分页和筛选',
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: '用户 ID' },
          page: { type: 'number', description: '页码，默认 1' },
          size: { type: 'number', description: '每页数量，默认 20' },
          category: { type: 'string', description: '按类别筛选（可选）' },
          keyword: { type: 'string', description: '按关键词搜索（可选）' },
        },
        required: ['userId'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                category: { type: 'string' },
                keywords: { type: 'array', items: { type: 'string' } },
                createdAt: { type: 'string' },
              },
            },
          },
          total: { type: 'number', description: '总数' },
          page: { type: 'number', description: '当前页' },
          size: { type: 'number', description: '每页数量' },
        },
      },
    },

    findOrCreate: {
      description: '查找或创建笔记：如果 URL 已有笔记则返回已有记录，否则创建新笔记',
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: '用户 ID' },
          url: { type: 'string', description: '文章 URL' },
          title: { type: 'string', description: '文章标题' },
          category: { type: 'string', description: '文章类别' },
          keywords: { type: 'array', items: { type: 'string' }, description: '关键词' },
          summary: { type: 'object', description: '概要信息' },
          quotes: { type: 'array', description: '引用列表' },
          extensions: { type: 'array', description: '引申话题（可选）' },
          rawContent: { type: 'string', description: '原始内容' },
          siteName: { type: 'string', description: '来源网站（可选）' },
          author: { type: 'string', description: '作者（可选）' },
        },
        required: ['userId', 'url', 'title', 'category', 'keywords', 'summary', 'rawContent'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '笔记 ID' },
          title: { type: 'string' },
          category: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          summary: { type: 'object' },
          quotes: { type: 'array' },
          extensions: { type: 'array' },
          createdAt: { type: 'string' },
        },
        description: '找到或创建的笔记对象',
      },
    },
  },
});
```

### 生成的 ToolConfig

工厂方法自动生成完整的 ToolConfig：

```typescript
// 自动生成的 config 结构
{
  id: 'note_tool',
  name: 'note',
  description: `笔记管理工具。

可用方法：
- create: 创建一条新笔记
- read: 根据 ID 读取笔记详情
- update: 更新已有笔记
- delete: 删除笔记
- findByUrl: 根据 URL 查找是否已有历史笔记
- list: 查询笔记列表
- findOrCreate: 查找或创建笔记

输入格式: { "method": "方法名", "params": { ...参数 } }`,

  parameters: {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        enum: ['create', 'read', 'update', 'delete', 'findByUrl', 'list', 'findOrCreate'],
        description: '要调用的方法名',
      },
      params: {
        type: 'object',
        description: '方法参数，根据 method 不同而不同',
      },
    },
    required: ['method', 'params'],
  },
}
```

## 注册机制整合

`createServiceTool` 返回的 `implementation` 类已带有 `@tool` 装饰器元数据，直接调用 `registerTool` 即可注册到 tsyringe 容器。

### 独立注册

```typescript
// src/server/core/tool/Note/index.ts
import { createServiceTool } from '../createServiceTool';
import { registerTool } from '@/server/decorator/core';
import { NoteService } from '@/server/service/NoteService';
import { ToolIds } from '@/shared/constants';

const { config, implementation: NoteTool } = createServiceTool(ToolIds.NOTE, {
  service: NoteService,
  methods: {
    // ... 方法定义
  },
});

// 直接注册，无需文件发现
registerTool(NoteTool, config);

export { NoteTool, config };
```

### 与现有发现机制共存

- **传统 Tool**：放 `src/server/core/tool/xxx/` 目录，由 `ToolService.discoverTools()` 文件扫描自动注册
- **ServiceTool**：调用 `registerServiceTools()` 主动注册

两者最终都通过 `registerTool` 注册到同一容器，Agent 无差别使用。

## 扩展能力

### 自定义逻辑

如果某个方法需要额外逻辑，可以覆盖：

```typescript
// src/server/core/tool/Note/index.ts
import { NoteToolConfig, NoteTool as BaseNoteTool } from './config';
import { tool } from '@/server/decorator/core';

@tool(ToolIds.NOTE)
export default class NoteTool extends BaseNoteTool {
  // 覆盖特定方法的处理
  async handleCreate(params: any, ctx: ExecutionContext) {
    // 自定义逻辑
    if (params.url) {
      const existing = await this.service.findByUrl(ctx.userId!, params.url);
      if (existing) {
        return {
          success: true,
          data: existing,
          message: '已存在相同 URL 的笔记',
        };
      }
    }
    return super.handleCreate(params, ctx);
  }
}
```

### 后置处理

```typescript
const { config, implementation } = createServiceTool(ToolIds.NOTE, {
  // ... spec

  // 可选：后置处理钩子
  afterCall: {
    create: (result, ctx) => {
      // 创建后触发事件
      ctx.emit('note_created', result);
      return result;
    },
  },
});
```

## 测试

```typescript
describe('createServiceTool', () => {
  it('should generate correct config', () => {
    const { config } = createServiceTool('test_tool', {
      service: MockService,
      methods: {
        read: {
          description: '读取数据',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
        },
      },
    });

    expect(config.id).toBe('test_tool');
    expect(config.description).toContain('read: 读取数据');
    expect(config.parameters.properties.method.enum).toEqual(['read']);
  });

  it('should call service method', async () => {
    const { implementation: Tool } = createServiceTool('test_tool', spec);
    const tool = container.resolve(Tool);

    const result = await collectAsync(
      tool.call({ method: 'read', params: { id: '1' } }, ctx),
    );

    expect(result[result.length - 1].output.success).toBe(true);
  });
});
```

## 最佳实践

1. **方法粒度**：暴露的方法应是 Agent 可理解的高层操作，而非细粒度的内部方法
2. **参数清晰**：每个参数都提供 description，便于 Agent 正确调用
3. **幂等设计**：尽量提供 `findOrCreate` 类方法，支持重试
4. **参数透明**：所有参数由 Agent 显式传入，包括 userId，便于调试和审计
