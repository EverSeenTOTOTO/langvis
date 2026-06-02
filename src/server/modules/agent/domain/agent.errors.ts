import { ExceptionBase } from '@/server/libs/exceptions/exception.base';

export class RunAlreadyCompletedError extends ExceptionBase {
  readonly code = 'RUN_ALREADY_COMPLETED';
  constructor(runId: string) {
    super(`Run ${runId} is already completed`);
  }
}

export class RunNotStartedError extends ExceptionBase {
  readonly code = 'RUN_NOT_STARTED';
  constructor(runId: string) {
    super(`Run ${runId} has not started yet`);
  }
}

export class ToolNotFoundError extends ExceptionBase {
  readonly code = 'TOOL_NOT_FOUND';
  constructor(toolName: string) {
    super(`Tool "${toolName}" is not registered`);
  }
}

export class ToolExecutionError extends ExceptionBase {
  readonly code = 'TOOL_EXECUTION_ERROR';
  readonly toolName: string;
  constructor(toolName: string, cause: Error) {
    super(`Tool "${toolName}" execution failed: ${cause.message}`);
    this.toolName = toolName;
  }
}

export class ConfigValidationError extends ExceptionBase {
  readonly code = 'CONFIG_VALIDATION_ERROR';
  readonly agentId: string;
  constructor(agentId: string, details: string) {
    super(`Config validation failed for agent "${agentId}": ${details}`);
    this.agentId = agentId;
  }
}
