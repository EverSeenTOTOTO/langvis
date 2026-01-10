import MarkdownRender from '@/client/components/MarkdownRender';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { Message } from '@/shared/entities/Message';
import { RobotOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Avatar } from 'antd';
import { observer } from 'mobx-react-lite';
import GirlFriendAgentMessage from './AgentMessage/GirlFriendAgent';
import MessageFooter from './MessageFooter';
import ReActAgentMessage from './AgentMessage/ReActAgent';

const renderMessage = (msg: Message) => {
  const conversationStore = useStore('conversation');
  const currentConversation = conversationStore.currentConversation;

  const agent = currentConversation?.config?.agent || AgentIds.CHAT;

  switch (agent) {
    case AgentIds.GIRLFRIEND:
      return <GirlFriendAgentMessage msg={msg} />;
    case AgentIds.REACT:
      return <ReActAgentMessage msg={msg} />;
    case AgentIds.CHAT:
    default:
      return <MarkdownRender>{msg.content}</MarkdownRender>;
  }
};

const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  return (
    <Bubble
      key={msg.id}
      placement="start"
      content={
        <>
          {renderMessage(msg)}
          <MessageFooter content={msg.content} />
        </>
      }
      loading={msg.meta?.loading}
      avatar={<Avatar icon={<RobotOutlined />} />}
      styles={{
        content: {
          backgroundColor: msg.meta?.error ? 'var(--ant-red-1)' : undefined,
          color: msg.meta?.error ? 'var(--ant-red-7)' : undefined,
        },
      }}
    />
  );
};

export default observer(AssistantMessage);
