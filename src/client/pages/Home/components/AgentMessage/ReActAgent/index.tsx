import { lazy, Suspense } from 'react';
import { AgentIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type { MessageRenderState } from '../deriveMessageState';
import { LoadingOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';
import { UniversalEventRenderer } from '../UniversalEventRenderer';

import './index.scss';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

/**
 * Derive state for ReAct agent (simplified)
 */
function deriveReActState(state: MessageRenderState) {
  const { hasContent, hasEvents, isTerminated } = state;
  return {
    showBubbleLoading: !hasContent && !hasEvents && !isTerminated,
  };
}

interface ReActEventRendererProps {
  state: MessageRenderState;
  conversationId: string;
}

const ReActEventRenderer: React.FC<ReActEventRendererProps> = ({
  state,
  conversationId,
}) => {
  return (
    <UniversalEventRenderer state={state} conversationId={conversationId} />
  );
};

const createReActRenderer = (agentId: string) => {
  const renderer = (
    msg: Message,
    state: MessageRenderState,
  ): AgentRenderResult => {
    const { showBubbleLoading } = deriveReActState(state);

    return {
      content: (
        <>
          {state.hasEvents && (
            <ReActEventRenderer
              state={state}
              conversationId={msg.conversationId}
            />
          )}

          {state.isAwaitingContent && (
            <Typography.Text type="secondary" italic>
              <LoadingOutlined style={{ marginInlineEnd: 4 }} />
              Thinking...
            </Typography.Text>
          )}

          <Suspense
            fallback={
              <Typography.Paragraph>{msg.content}</Typography.Paragraph>
            }
          >
            <MarkdownRender>{msg.content}</MarkdownRender>
          </Suspense>
        </>
      ),
      showBubbleLoading,
    };
  };

  registerAgentRenderer(agentId, renderer);
  return renderer;
};

const ReActAgentRenderer = createReActRenderer(AgentIds.REACT);

export { createReActRenderer };
export default ReActAgentRenderer;
