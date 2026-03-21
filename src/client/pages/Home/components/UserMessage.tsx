import Bubble from '@/client/components/Bubble';
import { lazy, Suspense } from 'react';
import { Message } from '@/shared/types/entities';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { RedoOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Typography } from 'antd';
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
        <Suspense
          fallback={<Typography.Paragraph>{msg.content}</Typography.Paragraph>}
        >
          <MarkdownRender>{msg.content}</MarkdownRender>
        </Suspense>
      }
      footer={
        <MessageFooter content={msg.content}>
          <Button
            color="default"
            variant="filled"
            icon={<RedoOutlined />}
            onClick={() => onRetry(msg.id)}
            size="small"
          />
        </MessageFooter>
      }
      loading={msg.loading}
      avatar={<Avatar icon={<UserOutlined />} />}
    />
  );
};

export default observer(UserMessage);
