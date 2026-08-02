import { lazy, Suspense } from 'react';
import type { MessageNode } from '@/client/store/modules/message-node';
import { LoadingOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import type React from 'react';
import AudioPlayer from '@/client/components/AudioPlayer';
import { UniversalEventRenderer } from './AgentMessage/UniversalEventRenderer';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

export type AgentRenderResult = {
  content: React.ReactNode;
};

export type AgentRenderer = (node: MessageNode) => AgentRenderResult;

// 富事件由 UniversalEventRenderer 渲染，文本回复走 Markdown；上下文用量经 conversation_usage/loop_usage 控制帧下发。
export const renderAgentMessage: AgentRenderer = node => ({
  content: (
    <>
      {node.timeline.length > 0 && <UniversalEventRenderer node={node} />}

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

      {node.audio && <AudioPlayer src={`/upload/${node.audio.filePath}`} />}
    </>
  ),
});
