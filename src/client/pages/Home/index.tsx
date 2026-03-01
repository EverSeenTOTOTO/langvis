import ChatInput from '@/client/components/ChatInput';
import Drawer from '@/client/components/Drawer';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { Role } from '@/shared/types/entities';
import { deriveMessageState } from '@/shared/utils';
import { MenuOutlined } from '@ant-design/icons';
import { Button, Layout, message } from 'antd';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useState } from 'react';
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
  const chatApi = useAsyncFn(chatStore.startChat.bind(chatStore));
  const cancelApi = useAsyncFn(chatStore.cancelChat.bind(chatStore));

  // Cancelling = cancel request in flight
  const isCancelling = cancelApi[0].loading;

  // Loading = last assistant message not terminated
  const isLoading = useMemo(() => {
    if (isCancelling) return false; // cancelling is a separate state

    const messages = conversationStore.currentMessages;
    const lastMessage = messages?.[messages.length - 1];
    if (!lastMessage || lastMessage.role !== Role.ASSIST) {
      return chatStore.isCurrentLoading; // fallback to phase-based check
    }
    return !deriveMessageState(lastMessage).isTerminated;
  }, [
    conversationStore.currentMessages,
    chatStore.isCurrentLoading,
    isCancelling,
  ]);

  const handleSend = async () => {
    if (!value) return;

    if (!conversationStore.currentConversationId) {
      await createConversationApi[1]({
        name: settingStore.tr('New Conversation'),
        config: {
          agent: AgentIds.CHAT,
        },
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

  const handleCancel = async () => {
    const conversationId = conversationStore.currentConversationId;
    if (!conversationId) return;

    const messages = conversationStore.messages[conversationId];
    const lastMessage = messages?.[messages.length - 1];

    await cancelApi[1]({
      conversationId,
      messageId: lastMessage?.id ?? '',
      reason: 'Cancelled by user',
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
          <ChatInput
            value={value}
            onChange={setValue}
            onSubmit={handleSend}
            onCancel={handleCancel}
            minRows={2}
            maxRows={6}
            header={
              isMobile && (
                <Button
                  className="chat-drawer-trigger"
                  size="small"
                  icon={<MenuOutlined />}
                  onClick={() => setDrawerOpen(true)}
                />
              )
            }
            placeholder={settingStore.tr('Type a message...')}
            loading={
              createConversationApi[0].loading ||
              chatApi[0].loading ||
              isLoading
            }
            cancelling={isCancelling}
          />
        </div>
        <div className="chat-placeholder" />
      </Content>
    </Layout>
  );
};

export default observer(Chat);
