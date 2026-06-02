import { container } from 'tsyringe';
import type { ToolResolver } from './domain/tool-resolver.port';
import type { ToolCall } from './domain/tool-call.entity';

export class ContainerToolResolver implements ToolResolver {
  resolve(toolName: string): ToolCall['tool'] | undefined {
    try {
      return container.resolve(toolName) as ToolCall['tool'];
    } catch {
      return undefined;
    }
  }
}
