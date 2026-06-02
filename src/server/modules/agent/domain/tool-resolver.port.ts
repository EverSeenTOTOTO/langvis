import type { ToolCall } from './tool-call.entity';

export interface ToolResolver {
  resolve(toolName: string): ToolCall['tool'] | undefined;
}
