import { ToolIds } from '@/shared/constants';
import chalk from 'chalk';
import { Tool } from '../../domain/model/tool.base';
import type { ToolCallContext } from '../../domain/port/tool-call-context.port';
import {
  validate,
  coerceJsonStringFields,
} from '@/server/utils/schemaValidator';
import logger from '@/server/utils/logger';

const metaDataKey = Symbol.for('config');

// 工具装饰器：声明 token 元数据 + 包一层 call 做输入校验/宽松还原。
// 实例化由 createTool 工厂（AgentModule 的 string-token providers）完成，不经 DI 容器。
export const tool = (token?: ToolIds) =>
  function configDecorator(target: any) {
    Reflect.defineMetadata(metaDataKey, { type: 'tool', token }, target);

    // 包一层 call：校验并宽松还原 ctx.input 后替换，再委托真实 call。
    // inputSchema 校验归属工具自身边界，ToolCall 编排不在承担；错误向上冒泡由 ToolCall 捕获转 tool_error。
    const original = target.prototype.call as Tool['call'];
    target.prototype.call = async function* (this: Tool, ctx: ToolCallContext) {
      const schema = this.config?.inputSchema;
      let input = ctx.input;
      if (schema) {
        let result = validate<Record<string, unknown>>(schema, input);
        // object/array 参数被模型当字符串传（引号/```围栏/双重编码）时，按声明类型宽松还原后再校验。
        if (!result.valid) {
          const recovered = coerceJsonStringFields(schema, input);
          if (recovered)
            result = validate<Record<string, unknown>>(schema, recovered);
        }
        if (!result.valid) {
          throw new Error(
            `Invalid input for tool "${this.id}": ${result.errors}`,
          );
        }
        input = result.data;
      }
      // 透传被委托 call 的产出值：遍历方读到 done 值时拿到工具真实输出。
      const output = yield* original.call(this, { ...ctx, input });
      return output;
    };
  };

export const toolIdOf = (Clz: new (...params: any[]) => Tool): ToolIds => {
  const { token } = Reflect.getMetadata(metaDataKey, Clz);
  return token;
};

/** 构造工具实例并注入 config/id/logger（AgentModule 按 string-token 注册为 provider）。 */
// 构造依赖经 AgentModule 的 TOOL_DEPS 接线表按位传入（esbuild 无 paramtypes）。
export const createTool = (
  Clz: new (...params: any[]) => Tool,

  config: any,
  deps: unknown[] = [],
): Tool => {
  const token = toolIdOf(Clz);

  const instance = new (Clz as any)(...deps);
  Reflect.set(instance, 'config', config);
  Reflect.set(instance, 'id', token);
  Reflect.set(instance, 'logger', logger.child({ source: token }));
  logger.info(
    `Register tool ${chalk.cyan(config.name)} with token ${chalk.yellow(token)}`,
  );
  return instance;
};
