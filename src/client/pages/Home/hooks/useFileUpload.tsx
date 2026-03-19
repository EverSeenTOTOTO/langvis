import { useStore } from '@/client/store';
import { PaperClipOutlined } from '@ant-design/icons';
import { Button, message, Tag, Upload } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { useCallback, useMemo, useState } from 'react';
import { useFileIcon } from './useFileIcon';

export interface Attachment {
  filename: string;
  url: string;
  size: number;
  mimeType: string;
}

export const useFileUpload = (isLoading: boolean) => {
  const conversationStore = useStore('conversation');
  const fileStore = useStore('file');
  const settingStore = useStore('setting');

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const { getFileIcon, getFileColor } = useFileIcon();

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

  const isUploading = fileList.some(f => f.status === 'uploading');

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

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setFileList([]);
  }, []);

  return {
    attachments,
    uploadButton,
    attachmentTags,
    isUploading,
    handleUpload,
    handleRemoveAttachment,
    clearAttachments,
  };
};
