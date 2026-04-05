import { AgentIds } from '@/shared/constants';
import type { MessageFSM } from '@/client/store/modules/MessageFSM';
import { LoadingOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import type React from 'react';
import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

export type AgentRenderResult = {
  content: React.ReactNode;
};

export type AgentRenderer = (fsm: MessageFSM) => AgentRenderResult;

// Registry of agent renderers
const agentRenderers = new Map<string, AgentRenderer>();

/**
 * Register a renderer for an agent type
 */
export function registerAgentRenderer(
  agentId: string,
  renderer: AgentRenderer,
): void {
  agentRenderers.set(agentId, renderer);
}

/**
 * Get renderer for an agent, falls back to default chat renderer
 */
export function getAgentRenderer(agentId: string): AgentRenderer {
  return agentRenderers.get(agentId) ?? defaultChatRenderer;
}

// Default chat renderer
const defaultChatRenderer: AgentRenderer = fsm => ({
  content: (
    <>
      {fsm.isAwaitingContent && (
        <Typography.Text type="secondary" italic>
          <LoadingOutlined style={{ marginInlineEnd: 4 }} />
          Thinking...
        </Typography.Text>
      )}
      <Suspense
        fallback={<Typography.Paragraph>{fsm.content}</Typography.Paragraph>}
      >
        <MarkdownRender>{fsm.content}</MarkdownRender>
      </Suspense>
    </>
  ),
});

// Register default renderer
registerAgentRenderer(AgentIds.CHAT, defaultChatRenderer);
