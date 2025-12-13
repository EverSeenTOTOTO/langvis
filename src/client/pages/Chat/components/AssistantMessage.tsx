import MarkdownRender from '@/client/components/MarkdownRender';
import { CopyOutlined, RobotOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Avatar, Button, Flex } from 'antd';
import { MessageProps } from './Messages';

const AssistantMessage: React.FC<MessageProps> = ({
  msg,
  index,
  currentMessages,
}) => {
  const copyToClipboard = () => {
    navigator.clipboard.writeText(msg.content);
  };

  const footer = (
    <Flex justify="end" className="message-footer" gap={4}>
      <Button
        color="default"
        variant="filled"
        icon={<CopyOutlined />}
        onClick={copyToClipboard}
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
          <MarkdownRender>{msg.content}</MarkdownRender>
          {footer}
        </>
      }
      loading={msg.meta?.loading}
      avatar={<Avatar icon={<RobotOutlined />} />}
      styles={
        index > 0 && currentMessages[index - 1].role === msg.role
          ? {
              avatar: {
                visibility: 'hidden',
              },
            }
          : {}
      }
    />
  );
};

export default AssistantMessage;

