import Bubble from '@/client/components/Bubble';
import { lazy, Suspense } from 'react';
import { Message } from '@/shared/types/entities';
import { useStore } from '@/client/store';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { RedoOutlined, ScissorOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Tag, Tooltip, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import MessageFooter from './MessageFooter';

const UserMessage: React.FC<{
  msg: Message;
  onRetry: (messageId: string) => void;
}> = ({ msg, onRetry }) => {
  const settingStore = useStore('setting');

  return (
    <Bubble
      key={msg.id}
      placement="end"
      content={
        <>
          {msg.meta?.reconstructed && (
            <Tooltip
              title={settingStore.tr(
                'Truncated to fit the model context window; only the beginning is sent to the model',
              )}
            >
              <Tag
                icon={<ScissorOutlined />}
                color="warning"
                bordered={false}
                style={{ marginInlineEnd: 0, marginBottom: 8 }}
              >
                {settingStore.tr('Context truncated')}
              </Tag>
            </Tooltip>
          )}
          <Suspense
            fallback={
              <Typography.Paragraph>{msg.content}</Typography.Paragraph>
            }
          >
            <MarkdownRender>{msg.content}</MarkdownRender>
          </Suspense>
        </>
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
