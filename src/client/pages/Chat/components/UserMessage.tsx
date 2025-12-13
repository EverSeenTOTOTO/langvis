import MarkdownRender from '@/client/components/MarkdownRender';
import { CopyOutlined, RedoOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Avatar, Button, Flex } from 'antd';
import { MessageProps } from './Messages';

const UserMessage: React.FC<MessageProps> = ({
  msg,
  index,
  currentMessages,
  onRetry,
}) => {
  const copyToClipboard = () => {
    navigator.clipboard.writeText(msg.content);
  };

  const footer = (
    <Flex justify="end">
      <Button
        type="text"
        icon={<CopyOutlined />}
        onClick={copyToClipboard}
        size="small"
      />
      <Button
        type="text"
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
      content={<MarkdownRender>{msg.content}</MarkdownRender>}
      loading={msg.loading}
      avatar={<Avatar icon={<UserOutlined />} />}
      styles={
        index > 0 && currentMessages[index - 1].role === msg.role
          ? {
              avatar: {
                visibility: 'hidden',
              },
            }
          : {}
      }
      footer={footer}
      footerPlacement="outer-end"
    />
  );
};

export default UserMessage;

