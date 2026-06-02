import { AgentIds } from '@/shared/constants';
import type { MessageNode } from '@/client/store/modules/message-node';
import { LoadingOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import type React from 'react';
import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

export type AgentRenderResult = {
  content: React.ReactNode;
};

export type AgentRenderer = (node: MessageNode) => AgentRenderResult;

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
const defaultChatRenderer: AgentRenderer = node => ({
  content: (
    <>
      {node.isThinking && (
        <Typography.Text type="secondary" italic>
          <LoadingOutlined style={{ marginInlineEnd: 4 }} />
          Thinking...
        </Typography.Text>
      )}
      <Suspense
        fallback={<Typography.Paragraph>{node.content}</Typography.Paragraph>}
      >
        <MarkdownRender>{node.content}</MarkdownRender>
      </Suspense>
    </>
  ),
});

// Register default renderer
registerAgentRenderer(AgentIds.CHAT, defaultChatRenderer);
