import { useStore } from '@/client/store';
import { lazy, Suspense } from 'react';
import { Button, Divider, Skeleton, Typography } from 'antd';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import type { Message } from '@/shared/types/entities';
import Modal from '@/client/components/Modal';

const CompactDivider: React.FC<{ msg: Message }> = ({ msg }) => {
  const settingStore = useStore('setting');

  return (
    <>
      <Divider>
        <Typography.Text type="secondary">
          {settingStore.tr('Conversation compacted')}{' '}
          <Modal
            title={settingStore.tr('Compacted summary')}
            footer={null}
            width={560}
            styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
            trigger={
              <Button type="link" size="small">
                {settingStore.tr('View summary')}
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

export default CompactDivider;
