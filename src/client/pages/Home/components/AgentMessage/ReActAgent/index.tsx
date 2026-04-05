import { lazy, Suspense } from 'react';
import { AgentIds } from '@/shared/constants';
import type { MessageFSM } from '@/client/store/modules/MessageFSM';
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
  const renderer = (fsm: MessageFSM): AgentRenderResult => ({
    content: (
      <>
        {fsm.hasEvents && <UniversalEventRenderer messageFSM={fsm} />}

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

  registerAgentRenderer(agentId, renderer);
  return renderer;
};

const ReActAgentRenderer = createReActRenderer(AgentIds.REACT);

export { createReActRenderer };
export default ReActAgentRenderer;
