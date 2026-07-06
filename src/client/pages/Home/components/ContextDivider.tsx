import { useStore } from '@/client/store';
import { lazy, Suspense } from 'react';
import { Button, Divider, Skeleton, Typography } from 'antd';
import dayjs from 'dayjs';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import type { Message } from '@/shared/types/entities';
import Modal from '@/client/components/Modal';

const ContextDivider: React.FC<{ msg: Message }> = ({ msg }) => {
  const settingStore = useStore('setting');
  const conversationStore = useStore('conversation');
  const createAt = conversationStore.currentConversation?.createdAt;

  return (
    <>
      <Divider>
        <Typography.Text type="secondary">
          {settingStore.tr('Conversation started')}{' '}
          {createAt ? dayjs(createAt).format('YYYY-MM-DD HH:mm:ss') : ''}{' '}
          <Modal
            title={settingStore.tr('Session context')}
            footer={null}
            width={560}
            styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
            trigger={
              <Button type="link" size="small">
                {settingStore.tr('View context')}
              </Button>
            }
          >
            <Suspense fallback={<Skeleton active />}>
              <MarkdownRender>{msg.content}</MarkdownRender>
            </Suspense>
          </Modal>
        </Typography.Text>
      </Divider>
    </>
  );
};

export default ContextDivider;
