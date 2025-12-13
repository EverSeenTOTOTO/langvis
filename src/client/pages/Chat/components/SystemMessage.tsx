import MarkdownRender from '@/client/components/MarkdownRender';
import { useStore } from '@/client/store';
import { Collapse, Divider, Typography } from 'antd';
import dayjs from 'dayjs';
import { observer } from 'mobx-react-lite';
import { MessageProps } from './Messages';

const SystemMessage: React.FC<MessageProps> = ({ msg }) => {
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

