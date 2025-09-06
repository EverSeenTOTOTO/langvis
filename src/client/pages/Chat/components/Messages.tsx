import { useStore } from '@/client/store';
import { Role } from '@/shared/entities/Message';
import { RobotOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Flex } from 'antd';
import { observer } from 'mobx-react-lite';

const fooAvatar: React.CSSProperties = {
  color: '#f56a00',
  backgroundColor: '#fde3cf',
};

const barAvatar: React.CSSProperties = {
  color: '#fff',
  backgroundColor: '#87d068',
};

const hideAvatar: React.CSSProperties = {
  visibility: 'hidden',
};

const Messages = () => {
  const conversationStore = useStore('conversation');
  const currentMessages = conversationStore.currentConversationId
    ? conversationStore.messages[conversationStore.currentConversationId] || []
    : [];

  return (
    <Flex gap="middle" vertical className="chat-messages">
      {currentMessages.map((msg, index) => (
        <Bubble
          key={msg.id}
          placement={msg.role === Role.USER ? 'end' : 'start'}
          content={msg.content}
          loading={msg.loading}
          avatar={
            msg.role === Role.USER
              ? { icon: <UserOutlined />, style: barAvatar }
              : { icon: <RobotOutlined />, style: fooAvatar }
          }
          styles={
            index > 0 && currentMessages[index - 1].role === msg.role
              ? { avatar: hideAvatar }
              : {}
          }
        />
      ))}
    </Flex>
  );
};

export default observer(Messages);

