import { Role } from '@/shared/types/entities';
import { ExecutionContext } from '@/server/core/context';

export function createMockContext(): ExecutionContext {
  return new ExecutionContext(
    {
      id: 'test-trace-id',
      role: Role.ASSIST,
      content: '',
      conversationId: 'test-conversation',
      createdAt: new Date(),
    },
    new AbortController(),
  );
}
