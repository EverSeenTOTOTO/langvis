import { lazy, Suspense } from 'react';
import { AgentIds } from '@/shared/constants';
import type { MessageNode } from '@/client/store/modules/message-node';
import { LoadingOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';
import { UniversalEventRenderer } from '../UniversalEventRenderer';

import './index.scss';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

const createReActRenderer = (agentId: string) => {
  const renderer = (node: MessageNode): AgentRenderResult => ({
    content: (
      <>
        {(node.toolCalls.length > 0 || node.thoughts.length > 0) && (
          <UniversalEventRenderer node={node} />
        )}

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

  registerAgentRenderer(agentId, renderer);
  return renderer;
};

const ReActAgentRenderer = createReActRenderer(AgentIds.REACT);

export { createReActRenderer };
export default ReActAgentRenderer;
