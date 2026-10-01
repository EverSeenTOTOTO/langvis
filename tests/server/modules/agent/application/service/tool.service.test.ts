import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import { TOOL_REGISTRY } from '@/server/modules/agent/implementations/tools/registry';
import { toolIdOf } from '@/server/modules/agent/application/tools/register-tool';
import { describe, beforeEach, expect, it, vi } from 'vitest';

// ModuleRef stub：string-token → 实例映射（等价 AgentModule 的 registry 生成 providers）
function makeModuleRef(instances: Map<string, unknown>) {
  return {
    get: (token: string) => {
      if (!instances.has(token)) throw new Error('not registered');
      return instances.get(token);
    },
  } as never;
}

// 显式 registry 契约：id 清单来自静态 registry，实例经 ModuleRef string-token 解析。
describe('ToolService', () => {
  let toolService: ToolService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始化收集 registry 全部工具 id，getAllToolInfo 返回对应信息', async () => {
    const instances = new Map<string, unknown>(
      TOOL_REGISTRY.map(({ clazz }) => [
        toolIdOf(clazz),
        { config: { name: `name_${toolIdOf(clazz)}` } },
      ]),
    );
    toolService = new ToolService(makeModuleRef(instances));

    const result = await toolService.getAllToolInfo();

    expect(result).toHaveLength(TOOL_REGISTRY.length);
    expect(result[0]).toMatchObject({
      id: toolIdOf(TOOL_REGISTRY[0]!.clazz),
    });
  });

  it('resolve 未注册 id 返回 undefined', () => {
    toolService = new ToolService(makeModuleRef(new Map()));
    expect(toolService.resolve('ghost_tool')).toBeUndefined();
  });

  it('初始化只执行一次（幂等）', async () => {
    const instances = new Map<string, unknown>(
      TOOL_REGISTRY.map(({ clazz }) => [toolIdOf(clazz), {}]),
    );
    toolService = new ToolService(makeModuleRef(instances));
    await toolService.getAllToolInfo();
    await toolService.getAllToolInfo();

    expect(toolService.getCachedToolIds()).toHaveLength(TOOL_REGISTRY.length);
  });
});
