import MarkdownRender from '@/client/components/MarkdownRender';
import { useStore } from '@/client/store';
import { Bubble } from '@ant-design/x';
import { Collapse, Typography } from 'antd';
import { MessageProps } from './Messages';
import dayjs from 'dayjs';
import { observer } from 'mobx-react-lite';

const SystemMessage: React.FC<MessageProps> = ({ msg }) => {
  const settingStore = useStore('setting');
  const conversationStore = useStore('conversation');

  const createAt = conversationStore.currentConversation?.createdAt;

  return (
    <>
      <Bubble.System
        key={msg.id}
        content={
          <Collapse
            defaultActiveKey={[]}
            items={[
              {
                key: '1',
                label: settingStore.tr('System Prompt'),
                children: <MarkdownRender>{msg.content}</MarkdownRender>,
                styles: {
                  body: {
                    maxHeight: 360,
                    overflow: 'auto',
                  },
                },
              },
            ]}
            style={{ width: '100%' }}
          />
        }
        styles={{
          root: { width: '100%' },
          body: { width: '100%' },
          content: { width: '100%' },
        }}
      />
      <Bubble.Divider
        content={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            对话开始于{' '}
            {createAt ? dayjs(createAt).format('YYYY-MM-DD HH:mm:ss') : ''}
          </Typography.Text>
        }
      />
    </>
  );
};

export default observer(SystemMessage);
