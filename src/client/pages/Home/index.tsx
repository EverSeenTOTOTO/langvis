import ChatInput from '@/client/components/ChatInput';
import Drawer from '@/client/components/Drawer';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import type { MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';
import { MenuOutlined } from '@ant-design/icons';
import { Button, Layout, message } from 'antd';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAsyncFn, useMedia } from 'react-use';
import { deriveMessageState } from './components/AgentMessage/deriveMessageState';
import ConversationsSider from './components/ConversationsSider';
import Messages, { type MessagesRef } from './components/Messages';
import { useFileUpload } from './hooks/useFileUpload';
import './index.scss';

const { Content } = Layout;

const Chat: React.FC = () => {
  const chatStore = useStore('chat');
  const conversationStore = useStore('conversation');
  const settingStore = useStore('setting');
  const [value, setValue] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(60);
  const isMobile = useMedia('(max-width: 768px)', false);
  const messagesRef = useRef<MessagesRef>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  const createConversationApi = useAsyncFn(
    conversationStore.createConversation.bind(conversationStore),
  );
  const chatApi = useAsyncFn(chatStore.startChat.bind(chatStore));
  const cancelApi = useAsyncFn(chatStore.cancelChat.bind(chatStore));

  // Cancelling = cancel request in flight
  const isCancelling = cancelApi[0].loading;

  // Loading = last assistant message not terminated
  const isLoading = useMemo(() => {
    if (isCancelling) return false;

    const messages = conversationStore.currentMessages;
    const lastMessage = messages?.[messages.length - 1];
    if (!lastMessage || lastMessage.role !== Role.ASSIST) {
      return chatStore.currentSession?.isLoading ?? false;
    }
    return !deriveMessageState(lastMessage).isTerminated;
  }, [
    conversationStore.currentMessages,
    chatStore.currentSession?.isLoading,
    isCancelling,
  ]);

  const { attachments, uploadButton, attachmentTags, clearAttachments } =
    useFileUpload(isLoading);

  const handleSend = async () => {
    if (!value && attachments.length === 0) return;

    // Scroll to bottom immediately when user sends
    messagesRef.current?.scrollToBottom(false);

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

    // Convert attachments to MessageAttachment format
    const messageAttachments: MessageAttachment[] | undefined =
      attachments.length > 0
        ? attachments.map(a => ({
            filename: a.filename,
            url: a.url,
            mimeType: a.mimeType,
            size: a.size,
          }))
        : undefined;

    // Build content with markdown attachments
    let finalContent = value;
    if (attachments.length > 0) {
      const attachmentMarkdown = attachments
        .map(a => {
          const isImage = a.mimeType.startsWith('image/');
          return isImage
            ? `![${a.filename}](${a.url})`
            : `[${a.filename}](${a.url})`;
        })
        .join('\n');
      finalContent = `${value}\n---\n${attachmentMarkdown}`;
    }

    setValue('');
    clearAttachments();

    await chatApi[1]({
      conversationId: conversationStore.currentConversationId,
      role: Role.USER,
      content: finalContent,
      attachments: messageAttachments,
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

  // Track input height for dynamic scroll button position
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver(entries => {
      setInputHeight(entries[0].contentRect.height);
    });
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

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
      <Content
        className="chat-content"
        style={
          { '--chat-input-height': `${inputHeight}px` } as React.CSSProperties
        }
      >
        <Messages ref={messagesRef} />
        <div className="chat-input" ref={inputRef}>
          <ChatInput
            value={value}
            onChange={setValue}
            onSubmit={handleSend}
            onCancel={handleCancel}
            minRows={2}
            maxRows={6}
            header={
              isMobile ? (
                <div className="chat-input-header-row">
                  <Button
                    className="chat-drawer-trigger"
                    size="small"
                    icon={<MenuOutlined />}
                    onClick={() => setDrawerOpen(true)}
                  />
                  {attachmentTags}
                </div>
              ) : (
                attachmentTags
              )
            }
            suffix={uploadButton}
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

