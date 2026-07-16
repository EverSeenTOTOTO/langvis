import Bubble from '@/client/components/Bubble';
import { useStore } from '@/client/store';
import { Message } from '@/shared/types/entities';
import { LoadingOutlined, RobotOutlined } from '@ant-design/icons';
import { Avatar, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { lazy, Suspense } from 'react';
import { renderAgentMessage } from './agentRenderers';
import MessageFooter from './MessageFooter';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const chatStore = useStore('chat');
  const node = chatStore.getMessageNode(msg.conversationId, msg.id);

  // MessageNode-driven rendering (both active and historical messages)
  if (node) {
    const { content } = renderAgentMessage(node);
    const hasError = node.status === 'failed' || node.status === 'cancelled';

    return (
      <Bubble
        key={msg.id}
        placement="start"
        content={
          node.isInitialized ? (
            <Typography.Text type="secondary" italic>
              <LoadingOutlined style={{ marginInlineEnd: 4 }} />
              Thinking...
            </Typography.Text>
          ) : (
            <>{content}</>
          )
        }
        footer={<MessageFooter content={node.content} />}
        loading={node.isInitialized}
        avatar={<Avatar icon={<RobotOutlined />} />}
        styles={{
          content: {
            backgroundColor: hasError ? 'var(--ant-red-1)' : undefined,
            color: hasError ? 'var(--ant-red-7)' : undefined,
          },
        }}
      />
    );
  }

  // Fallback: no MessageNode available, render from entity
  const hasError = msg.status === 'failed' || msg.status === 'cancelled';

  return (
    <Bubble
      key={msg.id}
      placement="start"
      content={
        msg.content ? (
          <Suspense
            fallback={
              <Typography.Paragraph>{msg.content}</Typography.Paragraph>
            }
          >
            <MarkdownRender>{msg.content}</MarkdownRender>
          </Suspense>
        ) : (
          <Typography.Text type="secondary" italic>
            <LoadingOutlined style={{ marginInlineEnd: 4 }} />
            Thinking...
          </Typography.Text>
        )
      }
      footer={<MessageFooter content={msg.content} />}
      avatar={<Avatar icon={<RobotOutlined />} />}
      styles={{
        content: {
          backgroundColor: hasError ? 'var(--ant-red-1)' : undefined,
          color: hasError ? 'var(--ant-red-7)' : undefined,
        },
      }}
    />
  );
};

export default observer(AssistantMessage);
