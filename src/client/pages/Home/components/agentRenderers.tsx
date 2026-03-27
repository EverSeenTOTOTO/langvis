import { AgentIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type { MessageRenderState } from './AgentMessage/deriveMessageState';
import { deriveMessageState } from './AgentMessage/deriveMessageState';
import { LoadingOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import type React from 'react';
import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

export type AgentRenderResult = {
  content: React.ReactNode;
};

export type AgentRenderer = (
  msg: Message,
  state: MessageRenderState,
) => AgentRenderResult;

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

/**
 * Render a message using the appropriate agent renderer
 */
export function renderAgentMessage(
  msg: Message,
  agentId: string,
): AgentRenderResult {
  const state = deriveMessageState(msg);
  const renderer = getAgentRenderer(agentId);
  return renderer(msg, state);
}

// Default chat renderer
const defaultChatRenderer: AgentRenderer = (msg, state) => ({
  content: (
    <>
      {state.isAwaitingContent && (
        <Typography.Text type="secondary" italic>
          <LoadingOutlined style={{ marginInlineEnd: 4 }} />
          Thinking...
        </Typography.Text>
      )}
      <Suspense
        fallback={<Typography.Paragraph>{msg.content}</Typography.Paragraph>}
      >
        <MarkdownRender>{msg.content}</MarkdownRender>
      </Suspense>
    </>
  ),
});

// Register default renderer
registerAgentRenderer(AgentIds.CHAT, defaultChatRenderer);
