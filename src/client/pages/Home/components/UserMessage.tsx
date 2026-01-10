import MarkdownRender from '@/client/components/MarkdownRender';
import { Message } from '@/shared/entities/Message';
import { RedoOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Avatar, Button } from 'antd';
import { observer } from 'mobx-react-lite';
import MessageFooter from './MessageFooter';

const UserMessage: React.FC<{
  msg: Message;
  onRetry: (messageId: string) => void;
}> = ({ msg, onRetry }) => {
  return (
    <Bubble
      key={msg.id}
      placement="end"
      content={
        <>
          <MarkdownRender>{msg.content}</MarkdownRender>
          <MessageFooter content={msg.content}>
            <Button
              color="default"
              variant="filled"
              icon={<RedoOutlined />}
              onClick={() => onRetry(msg.id)}
              size="small"
            />
          </MessageFooter>
        </>
      }
      loading={msg.loading}
      avatar={<Avatar icon={<UserOutlined />} />}
    />
  );
};

export default observer(UserMessage);
