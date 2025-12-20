import Drawer from '@/client/components/Drawer';
import { useStore } from '@/client/store';
import { Role } from '@/shared/entities/Message';
import { MenuOutlined } from '@ant-design/icons';
import { Sender } from '@ant-design/x';
import { FloatButton, Layout, message } from 'antd';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAsyncFn, useMedia } from 'react-use';
import ConversationsSider from './components/ConversationsSider';
import Messages from './components/Messages';
import './index.scss';

const { Content } = Layout;

const Chat: React.FC = () => {
  const chatStore = useStore('chat');
  const conversationStore = useStore('conversation');
  const settingStore = useStore('setting');
  const [value, setValue] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useMedia('(max-width: 768px)', false);

  const createConversationApi = useAsyncFn(
    conversationStore.createConversation.bind(conversationStore),
  );
  const addMessageApi = useAsyncFn(
    conversationStore.addMessageToConversation.bind(conversationStore),
  );
  const chatApi = useAsyncFn(chatStore.startChat.bind(chatStore));

  const handleSend = async () => {
    if (!value) return;

    if (!conversationStore.currentConversationId) {
      await createConversationApi[1]({
        name: settingStore.tr('New Conversation'),
      });
    }

    if (!conversationStore.currentConversationId) {
      message.error(settingStore.tr('Failed to create or get conversation'));
      return;
    }

    setValue('');

    await chatApi[1]({
      id: conversationStore.currentConversationId,
      role: Role.USER,
      content: value,
    });
  };

  return (
    <Layout className="chat-page">
      {isMobile ? (
        <>
          <FloatButton
            className="chat-drawer-trigger"
            icon={<MenuOutlined />}
            onClick={() => setDrawerOpen(true)}
          />
          <Drawer
            title={settingStore.tr('Conversations')}
            open={drawerOpen}
            onCancel={() => setDrawerOpen(false)}
            placement="left"
            styles={{
              wrapper: { width: 'calc(var(--menu-width) + 24px)' },
              body: { padding: '0 12px' },
            }}
          >
            <ConversationsSider
              onConversationChange={() => setDrawerOpen(false)}
            />
          </Drawer>
        </>
      ) : (
        <ConversationsSider />
      )}
      <Content className="chat-content">
        <Messages />
        <div className="chat-input">
          <Sender
            value={value}
            onChange={setValue}
            onSubmit={handleSend}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder={settingStore.tr('Type a message...')}
            loading={
              addMessageApi[0].loading ||
              createConversationApi[0].loading ||
              chatApi[0].loading
            }
          />
        </div>
        <div className="chat-input-placeholder" />
      </Content>
    </Layout>
  );
};

export default observer(Chat);
