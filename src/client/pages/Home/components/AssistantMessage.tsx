import MarkdownRender from '@/client/components/MarkdownRender';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { Message } from '@/shared/entities/Message';
import { CopyOutlined, RobotOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Avatar, Button, Flex } from 'antd';
import { observer } from 'mobx-react-lite';
import { useCopyToClipboard } from 'react-use';
import GirlFriendAgentMessage from './AgentMessage/GirlFriendAgent';

const renderMessage = (msg: Message) => {
  const conversationStore = useStore('conversation');
  const currentConversation = conversationStore.currentConversation;

  const agent = currentConversation?.config?.agent || AgentIds.CHAT_AGENT;

  switch (agent) {
    case AgentIds.GIRLFRIEND_AGENT:
      return <GirlFriendAgentMessage msg={msg} />;
    case AgentIds.CHAT_AGENT:
    default:
      return <MarkdownRender>{msg.content}</MarkdownRender>;
  }
};

const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const [, copyToClipboard] = useCopyToClipboard();

  const footer = (
    <Flex justify="end" className="message-footer" gap={4}>
      <Button
        color="default"
        variant="filled"
        icon={<CopyOutlined />}
        onClick={() => copyToClipboard(msg.content)}
        size="small"
      />
    </Flex>
  );

  return (
    <Bubble
      key={msg.id}
      placement="start"
      content={
        <>
          {renderMessage(msg)}
          {footer}
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
