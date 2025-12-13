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
    <Flex justify="end">
      <Button
        type="text"
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
      content={<MarkdownRender>{msg.content}</MarkdownRender>}
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
      footer={footer}
      footerPlacement="outer-end"
    />
  );
};

export default AssistantMessage;

