import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import chalk from 'chalk';
import { container, injectable, Lifecycle } from 'tsyringe';
import { Tool } from '../modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '../modules/agent/domain/port/tool-call-context.port';
import { validate, coerceJsonStringFields } from '../utils/schemaValidator';
import logger from '../utils/logger';

const metaDataKey = Symbol.for('config');

export const tool = (token?: ToolIds) =>
  function configDecorator(target: any) {
    injectable()(target);
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

export const registerTool = async <I, O>(
  Clz: new (...params: any[]) => Tool,
  config: ToolConfig<I, O>,
) => {
  const { token } = Reflect.getMetadata(metaDataKey, Clz);

  container.register<Tool>(token, Clz, {
    lifecycle: Lifecycle.Singleton,
  });

  logger.info(
    `Register tool ${chalk.cyan(config.name)} with token ${chalk.yellow(token)}`,
  );

  container.afterResolution(
    token,
    (_token, instance: any) => {
      Reflect.set(instance, 'config', config);
      Reflect.set(instance, 'id', token);
      Reflect.set(instance, 'logger', logger.child({ source: token }));
    },
    { frequency: 'Once' },
  );

  return token;
};
