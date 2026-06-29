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

/**
 * 单一 agent 渲染器——收敛多 agent 后不再有 renderer 注册表。
 * 富事件（thought / tool_call / tool_result 等）由 UniversalEventRenderer
 * 渲染，文本回复走 Markdown；TTS 等工具产物的音频路径也经工具结果事件呈现。
 * （上下文用量不再是 run 富事件——经独立会话级控制帧 conversation_usage / loop_usage 下发。）
 */
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
