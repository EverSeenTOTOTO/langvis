import Drawer from '@/client/components/Drawer';
import { useStore } from '@/client/store';
import { Role } from '@/shared/types/entities';
import { MenuOutlined } from '@ant-design/icons';
import { Sender } from '@ant-design/x';
import { Button, Flex, Layout, message } from 'antd';
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
      conversationId: conversationStore.currentConversationId,
      role: Role.USER,
      content: value,
    });
  };

  const cancelApi = useAsyncFn(chatStore.cancelChat.bind(chatStore));

  const handleCancel = async () => {
    if (!conversationStore.activeAssistMessage) return;

    await cancelApi[1]({
      conversationId: conversationStore.currentConversationId!,
      messageId: conversationStore.activeAssistMessage.id,
    });
  };

  return (
    <Layout className="chat-page">
      {isMobile ? (
        <Drawer
          title={settingStore.tr('Conversations')}
          open={drawerOpen}
          onCancel={() => setDrawerOpen(false)}
          placement="left"
          styles={{
            wrapper: { width: 'calc(var(--menu-width) + 24px)' },
            body: {
              padding: isMobile ? '24px 12px' : '0 12px',
            },
          }}
        >
          <ConversationsSider
            onConversationChange={() => setDrawerOpen(false)}
          />
        </Drawer>
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
            onCancel={handleCancel}
            autoSize={{ minRows: 2, maxRows: 6 }}
            header={
              <Flex className="chat-header">
                {isMobile && (
                  <Button
                    className="chat-drawer-trigger"
                    size="small"
                    icon={<MenuOutlined />}
                    onClick={() => setDrawerOpen(true)}
                  />
                )}
              </Flex>
            }
            placeholder={settingStore.tr('Type a message...')}
            loading={
              conversationStore.activeAssistMessage?.meta?.loading ||
              conversationStore.activeAssistMessage?.meta?.streaming ||
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
