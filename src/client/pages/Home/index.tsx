import ChatInput from '@/client/components/ChatInput';
import Drawer from '@/client/components/Drawer';
import { useStore } from '@/client/store';
import { getFileColor, getFileIcon } from '@/client/utils/fileIcon';
import { AgentIds } from '@/shared/constants';
import type { MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';
import { deriveMessageState } from './components/AgentMessage/deriveMessageState';
import { MenuOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Button, Layout, message, Tag, Upload } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useState } from 'react';
import { useAsyncFn, useMedia } from 'react-use';
import ConversationsSider from './components/ConversationsSider';
import Messages from './components/Messages';
import './index.scss';

const { Content } = Layout;

interface Attachment {
  filename: string;
  url: string;
  size: number;
  mimeType: string;
}

const Chat: React.FC = () => {
  const chatStore = useStore('chat');
  const conversationStore = useStore('conversation');
  const settingStore = useStore('setting');
  const fileStore = useStore('file');
  const [value, setValue] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
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
      return chatStore.currentSession?.isLoading ?? false; // fallback to phase-based check
    }
    return !deriveMessageState(lastMessage).isTerminated;
  }, [
    conversationStore.currentMessages,
    chatStore.currentSession?.isLoading,
    isCancelling,
  ]);

  // Get upload config from current agent
  const uploadConfig = useMemo(() => {
    const agentConfig = (conversationStore.currentConversation as any)?.config;
    return (
      agentConfig?.upload || {
        maxSize: 10 * 1024 * 1024,
        allowedTypes: ['image/*', 'application/pdf', 'text/*'],
      }
    );
  }, [conversationStore.currentConversation]);

  const handleUpload = useCallback(
    async (file: File): Promise<Attachment | null> => {
      const tempUid = `temp-${Date.now()}`;

      // Add to file list with loading state
      setFileList(prev => [
        ...prev,
        {
          uid: tempUid,
          name: file.name,
          status: 'uploading',
          percent: 0,
        } as UploadFile,
      ]);

      try {
        const result = await fileStore.upload({
          file,
          agent: (conversationStore.currentConversation as any)?.config?.agent,
        });
        const attachment: Attachment = {
          filename: result.filename,
          url: result.url,
          size: result.size,
          mimeType: result.mimeType,
        };
        setAttachments(prev => [...prev, attachment]);

        // Update file list to success
        setFileList(prev =>
          prev.map(f =>
            f.uid === tempUid
              ? {
                  ...f,
                  status: 'done',
                  uid: result.filename,
                  name: result.filename,
                }
              : f,
          ),
        );

        return attachment;
      } catch {
        message.error(settingStore.tr('Failed to upload file'));
        // Remove from file list
        setFileList(prev => prev.filter(f => f.uid !== tempUid));
        return null;
      }
    },
    [fileStore, conversationStore.currentConversation, settingStore],
  );

  const handleRemoveAttachment = useCallback((filename: string) => {
    setAttachments(prev => prev.filter(a => a.filename !== filename));
    setFileList(prev =>
      prev.filter(f => f.uid !== filename && f.name !== filename),
    );
  }, []);

  const handleSend = async () => {
    if (!value && attachments.length === 0) return;

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
    setAttachments([]);
    setFileList([]);

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

  // Check if any file is uploading
  const isUploading = fileList.some(f => f.status === 'uploading');

  // Upload button component
  const uploadButton = (
    <Upload
      accept={
        uploadConfig.allowedTypes?.includes('*')
          ? undefined
          : uploadConfig.allowedTypes?.join(',')
      }
      showUploadList={false}
      beforeUpload={file => {
        if (uploadConfig.maxSize && file.size > uploadConfig.maxSize) {
          message.error(
            `File size exceeds limit: ${(uploadConfig.maxSize / 1024 / 1024).toFixed(1)}MB`,
          );
          return false;
        }
        handleUpload(file);
        return false;
      }}
      disabled={isLoading || isUploading}
    >
      <Button
        icon={<PaperClipOutlined />}
        disabled={isLoading || isUploading}
        size="small"
      />
    </Upload>
  );

  // Render attachment tags with file type icons
  const attachmentTags = useMemo(() => {
    if (fileList.length === 0) return null;

    return (
      <div className="chat-attachments">
        {fileList.map(file => {
          const attachment = attachments.find(
            a => a.filename === file.uid || a.filename === file.name,
          );
          const mimeType = attachment?.mimeType || 'application/octet-stream';
          const isFileUploading = file.status === 'uploading';

          return (
            <Tag
              key={file.uid}
              className="attachment-tag"
              closable={!isFileUploading}
              onClose={e => {
                e.preventDefault();
                handleRemoveAttachment(file.uid);
              }}
              style={{
                borderColor: isFileUploading
                  ? undefined
                  : getFileColor(mimeType),
              }}
            >
              {isFileUploading ? (
                <>
                  <span className="attachment-loading" />
                  <span className="attachment-name">{file.name}</span>
                </>
              ) : (
                <>
                  <span style={{ color: getFileColor(mimeType) }}>
                    {getFileIcon(mimeType)}
                  </span>
                  <span className="attachment-name">{file.name}</span>
                </>
              )}
            </Tag>
          );
        })}
      </div>
    );
  }, [fileList, attachments, handleRemoveAttachment]);

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
