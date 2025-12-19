import MarkdownRender from '@/client/components/MarkdownRender';
import useClipboard from '@/client/hooks/useClipboard';
import { Message } from '@/shared/entities/Message';
import { CopyOutlined, RobotOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Avatar, Button, Flex } from 'antd';

const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
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
      styles={{
        content: {
          backgroundColor: msg.meta?.error ? 'var(--ant-red-1)' : undefined,
          color: msg.meta?.error ? 'var(--ant-red-7)' : undefined,
        },
      }}
    />
  );
};

export default AssistantMessage;
