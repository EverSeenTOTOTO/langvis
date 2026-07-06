import { useStore } from '@/client/store';
import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { Message } from '@/shared/types/entities';
import { Collapse, Typography } from 'antd';
import { observer } from 'mobx-react-lite';

const SystemMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const settingStore = useStore('setting');

  return (
    <div className="system-message">
      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: '1',
            label: settingStore.tr('System Prompt'),
            children: (
              <Suspense
                fallback={
                  <Typography.Paragraph>{msg.content}</Typography.Paragraph>
                }
              >
                <MarkdownRender>{msg.content}</MarkdownRender>
              </Suspense>
            ),
          },
        ]}
        style={{ width: '100%' }}
        styles={{
          body: {
            maxHeight: 360,
            overflow: 'auto',
          },
        }}
      />
    </div>
  );
};

export default observer(SystemMessage);
