import { Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import Logger from '@/server/utils/logger';
import { toolIdOf } from '@/server/modules/agent/application/tools/register-tool';
import type { Tool } from '../../domain/model/tool.base';

// 工具目录服务：id 清单来自静态 registry（惰性加载切 TDZ 环），实例解析走 ModuleRef
// 的 string-token 查找（LLM 运行期按 id 寻址；providers 由 AgentModule 从 registry 生成）。
export class ToolService {
  private readonly logger = Logger.child({ source: 'ToolService' });

  private tools: string[] = [];
  private isInitialized = false;

  constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

  async getAllToolInfo() {
    await this.initialize();
    return this.tools.map(tool => ({
      id: tool,
      ...this.resolve(tool)?.config,
    }));
  }

  /** 按 id 解析工具实例；未注册返回 undefined（动态注册表查询，非静态依赖）。 */
  resolve(id: string): Tool | undefined {
    try {
      return this.moduleRef.get<Tool>(id, { strict: false });
    } catch {
      return undefined;
    }
  }

  getCachedToolIds(): string[] {
    return this.tools;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;

    try {
      // 惰性加载切静态环：registry → 各工具模块 → 本服务（TDZ）。
      const { TOOL_REGISTRY } = await import(
        '../../implementations/tools/registry'
      );
      this.tools = TOOL_REGISTRY.map(({ clazz }) => toolIdOf(clazz));

      this.logger.info(
        `Registered ${this.tools.length} tools: ${TOOL_REGISTRY.map(a => a.clazz.name).join(', ')}`,
      );
    } catch (e) {
      this.isInitialized = false;
      this.logger.error('Failed to initialize ToolService:', e);
    }
  }
}
