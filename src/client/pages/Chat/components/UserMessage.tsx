import MarkdownRender from '@/client/components/MarkdownRender';
import useClipboard from '@/client/hooks/useClipboard';
import { Message } from '@/shared/entities/Message';
import { CopyOutlined, RedoOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Avatar, Button, Flex } from 'antd';

const UserMessage: React.FC<{
  msg: Message;
  onRetry: (messageId: string) => void;
}> = ({ msg, onRetry }) => {
  const { copyToClipboard } = useClipboard();

  const footer = (
    <Flex justify="end" className="message-footer" gap={4}>
      <Button
        color="default"
        variant="filled"
        icon={<CopyOutlined />}
        onClick={() => copyToClipboard(msg.content)}
        size="small"
      />
      <Button
        color="default"
        variant="filled"
        icon={<RedoOutlined />}
        onClick={() => onRetry(msg.id)}
        size="small"
      />
    </Flex>
  );

  return (
    <Bubble
      key={msg.id}
      placement="end"
      content={
        <>
          <MarkdownRender>{msg.content}</MarkdownRender>
          {footer}
        </>
      }
      loading={msg.loading}
      avatar={<Avatar icon={<UserOutlined />} />}
    />
  );
};

export default UserMessage;
