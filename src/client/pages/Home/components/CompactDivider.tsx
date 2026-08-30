import { useStore } from '@/client/store';
import { Suspense } from 'react';
import { Button, Divider, Skeleton, Typography } from 'antd';
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
              <pre>{msg.content}</pre>
            </Suspense>
          </Modal>
        </Typography.Text>
      </Divider>
    </>
  );
};

export default CompactDivider;
