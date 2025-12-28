import MarkdownRender from '@/client/components/MarkdownRender';
import { useStore } from '@/client/store';
import { Message } from '@/shared/entities/Message';
import { Collapse, Divider, Typography } from 'antd';
import dayjs from 'dayjs';
import { observer } from 'mobx-react-lite';

const SystemMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const settingStore = useStore('setting');
  const conversationStore = useStore('conversation');

  const createAt = conversationStore.currentConversation?.createdAt;

  return (
    <div className="system-message">
      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: '1',
            label: settingStore.tr('System Prompt'),
            children: <MarkdownRender>{msg.content}</MarkdownRender>,
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
      <Divider>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          对话开始于{' '}
          {createAt ? dayjs(createAt).format('YYYY-MM-DD HH:mm:ss') : ''}
        </Typography.Text>
      </Divider>
    </div>
  );
};

export default observer(SystemMessage);
