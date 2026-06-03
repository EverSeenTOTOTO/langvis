import type { AgentBinding } from '@/shared/types/agent';

export function extractBinding(conv: {
  config?: Record<string, any> | null;
}): AgentBinding {
  const config = conv.config ?? {};
  const { agent: agentId, ...restConfig } = config as any;
  return { agentId: agentId ?? 'chat_agent', config: restConfig };
}
