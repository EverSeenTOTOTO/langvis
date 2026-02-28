import Bubble from '@/client/components/Bubble';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { Message } from '@/shared/types/entities';
import { RobotOutlined } from '@ant-design/icons';
import { Avatar } from 'antd';
import { observer } from 'mobx-react-lite';
import { renderAgentMessage } from './agentRenderers';
import MessageFooter from './MessageFooter';

// Import agent renderers to register them
import './AgentMessage/GirlFriendAgent';
import './AgentMessage/ReActAgent';

const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const conversationStore = useStore('conversation');
  const chatStore = useStore('chat');

  const currentConversation = conversationStore.currentConversation;
  const agent = currentConversation?.config?.agent || AgentIds.CHAT;

  const { content, showBubbleLoading } = renderAgentMessage(msg, agent);
  const hasError = msg.meta?.events?.some(e => e.type === 'error');

  // Loading state comes from phase
  const isLoading = chatStore.isCurrentLoading;

  return (
    <Bubble
      key={msg.id}
      placement="start"
      content={content}
      footer={<MessageFooter content={msg.content} />}
      loading={showBubbleLoading && isLoading}
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
