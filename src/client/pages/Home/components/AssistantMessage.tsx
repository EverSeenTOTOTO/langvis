import Bubble from '@/client/components/Bubble';
import MarkdownRender from '@/client/components/MarkdownRender';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { Message } from '@/shared/types/entities';
import { RobotOutlined } from '@ant-design/icons';
import { Avatar } from 'antd';
import { observer } from 'mobx-react-lite';
import GirlFriendAgentMessage from './AgentMessage/GirlFriendAgent';
import ReActAgentMessage from './AgentMessage/ReActAgent';
import MessageFooter from './MessageFooter';

interface AgentRenderResult {
  content: React.ReactNode;
  isLoading: boolean;
}

const renderMessage = (msg: Message): AgentRenderResult => {
  const conversationStore = useStore('conversation');
  const currentConversation = conversationStore.currentConversation;

  const agent = currentConversation?.config?.agent || AgentIds.CHAT;
  const hasFinalOrError = msg.meta?.events?.some(e =>
    ['final', 'error'].includes(e.type),
  );

  switch (agent) {
    case AgentIds.GIRLFRIEND:
      return GirlFriendAgentMessage({ msg });
    case AgentIds.REACT:
      return ReActAgentMessage({ msg });
    case AgentIds.CHAT:
    default:
      return {
        content: <MarkdownRender>{msg.content}</MarkdownRender>,
        isLoading: msg.content.length === 0 && !hasFinalOrError,
      };
  }
};

const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const { content, isLoading } = renderMessage(msg);
  const hasError = msg.meta?.events?.some(e => e.type === 'error');

  return (
    <Bubble
      key={msg.id}
      placement="start"
      content={content}
      footer={<MessageFooter content={msg.content} />}
      loading={isLoading}
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
