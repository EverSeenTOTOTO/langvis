import MarkdownRender from '@/client/components/MarkdownRender';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { Message } from '@/shared/types/entities';
import { isMessageLoading } from '@/shared/utils';
import { RobotOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Avatar, Flex } from 'antd';
import { observer } from 'mobx-react-lite';
import GirlFriendAgentMessage from './AgentMessage/GirlFriendAgent';
import ReActAgentMessage from './AgentMessage/ReActAgent';
import MessageFooter from './MessageFooter';

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
  const hasError = msg.meta?.events?.some(e => e.type === 'error');
  return (
    <Bubble
      key={msg.id}
      placement="start"
      content={
        <Flex vertical align="start" gap={8} style={{ minWidth: 200 }}>
          {renderMessage(msg)}
          <MessageFooter content={msg.content} />
        </Flex>
      }
      loading={isMessageLoading(msg)}
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
