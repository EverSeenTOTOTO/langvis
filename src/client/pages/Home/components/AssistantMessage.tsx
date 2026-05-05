import Bubble from '@/client/components/Bubble';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { Message } from '@/shared/types/entities';
import { LoadingOutlined, RobotOutlined } from '@ant-design/icons';
import { Avatar, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { lazy, Suspense } from 'react';
import { getAgentRenderer } from './agentRenderers';
import MessageFooter from './MessageFooter';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

// Dynamically load all agent renderers (side effect: auto-registration)
import.meta.glob('./AgentMessage/*/index.tsx', { eager: true });

const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const chatStore = useStore('chat');
  const session = chatStore.currentSession;
  const messageFSM = session?.getMessageFSM(msg.id);

  // Active message: render from FSM
  if (messageFSM && !messageFSM.isTerminated) {
    const agent = (session?.conv?.config?.agent as string) || AgentIds.CHAT;
    const { content } = getAgentRenderer(agent)(messageFSM);
    const hasError =
      messageFSM.phase === 'error' || messageFSM.phase === 'canceled';

    return (
      <Bubble
        key={msg.id}
        placement="start"
        content={
          messageFSM.isInitialized ? (
            <Typography.Text type="secondary" italic>
              <LoadingOutlined style={{ marginInlineEnd: 4 }} />
              Thinking...
            </Typography.Text>
          ) : (
            content
          )
        }
        footer={<MessageFooter content={messageFSM.msg.content} />}
        loading={messageFSM.isInitialized}
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

  // Terminated or no FSM: render from entity
  const hasError = msg.status === 'error' || msg.status === 'canceled';

  return (
    <Bubble
      key={msg.id}
      placement="start"
      content={
        msg.content ? (
          <Suspense fallback={<Typography.Paragraph>{msg.content}</Typography.Paragraph>}>
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
