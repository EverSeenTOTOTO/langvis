/**
 * 领域异常基类。
 * 每个限界上下文定义自己的错误类型，继承此基类。
 *
 * @see docs/plans/2026-05-30-ddd-refactor/01-architecture-overview.md
 */

export abstract class ExceptionBase extends Error {
  abstract readonly code: string;
  readonly correlationId?: string;

  constructor(message: string, correlationId?: string) {
    super(message);
    this.name = this.constructor.name;
    this.correlationId = correlationId;
  }
}
