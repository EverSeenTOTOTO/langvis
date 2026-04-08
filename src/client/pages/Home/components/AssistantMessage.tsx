import Bubble from '@/client/components/Bubble';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { Message } from '@/shared/types/entities';
import { LoadingOutlined, RobotOutlined } from '@ant-design/icons';
import { Avatar, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { getAgentRenderer } from './agentRenderers';
import MessageFooter from './MessageFooter';

// Dynamically load all agent renderers (side effect: auto-registration)
import.meta.glob('./AgentMessage/*/index.tsx', { eager: true });

const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const chatStore = useStore('chat');

  // Get FSM for this message
  const session = chatStore.currentSession;
  const messageFSM = session?.getOrCreateMessageFSM(msg);

  // Fallback if no FSM available (shouldn't happen in normal flow)
  if (!messageFSM) {
    return (
      <Bubble
        key={msg.id}
        placement="start"
        content={msg.content}
        footer={<MessageFooter content={msg.content} />}
        avatar={<Avatar icon={<RobotOutlined />} />}
      />
    );
  }

  // Get agent from conversation config
  const agent = (session?.config?.agent as string) || AgentIds.CHAT;

  // Render content using agent renderer
  const { content } = getAgentRenderer(agent)(messageFSM);

  // Check for error or canceled state
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
      footer={<MessageFooter content={messageFSM.content} />}
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
};

export default observer(AssistantMessage);
