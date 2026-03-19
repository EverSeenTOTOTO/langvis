import { useStore } from '@/client/store';
import { useFileIcon } from '@/client/pages/Home/hooks/useFileIcon';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { Breadcrumb, Button, Layout, Popconfirm, message, theme } from 'antd';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useState } from 'react';
import { useAsyncFn } from 'react-use';
import { FilePreview, isImage } from './FilePreview';
import './index.scss';

const formatSize = (bytes: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const Files: React.FC = () => {
  const fileStore = useStore('file');
  const settingStore = useStore('setting');
  const { token } = theme.useToken();
  const { getFileIcon, getFileColor, getFolderIcon } = useFileIcon();

  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');

  const dirPath = currentPath.join('/');
  const previewFilename = previewFile || '';

  const [listState, doList] = useAsyncFn(async () => {
    await fileStore.list({
      page: 1,
      pageSize: 9999,
      dir: dirPath || undefined,
    });
  }, [dirPath]);

  const [, doDelete] = useAsyncFn(
    async (filename: string) => {
      const fullPath = dirPath ? `${dirPath}/${filename}` : filename;
      await fileStore.delete({ filename: fullPath });
      message.success(settingStore.tr('File deleted successfully'));
      doList();
    },
    [dirPath, doList],
  );

  useEffect(() => {
    doList();
  }, [doList]);

  const handleFolderClick = (name: string) => {
    setCurrentPath(prev => [...prev, name]);
  };

  const handleBreadcrumbClick = (index: number) => {
    setCurrentPath(prev => prev.slice(0, index));
  };

  const handleFileClick = (item: (typeof fileStore.items)[0]) => {
    if (isImage(item.filename)) {
      setPreviewFile(item.filename);
      setPreviewUrl(item.url);
    } else {
      const playUrl = item.url.replace(
        '/api/files/download/',
        '/api/files/play/',
      );
      window.open(playUrl, '_blank');
    }
  };

  const breadcrumbItems = [
    {
      title: (
        <span onClick={() => handleBreadcrumbClick(0)}>
          {settingStore.tr('Files')}
        </span>
      ),
    },
    ...currentPath.map((segment, index) => ({
      title: (
        <span onClick={() => handleBreadcrumbClick(index + 1)}>{segment}</span>
      ),
    })),
  ];

  return (
    <Layout className="files-page">
      <div className="files-toolbar">
        <div className="breadcrumb-wrapper">
          <Breadcrumb items={breadcrumbItems} />
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={doList}
          loading={listState.loading}
        >
          {settingStore.tr('Refresh')}
        </Button>
      </div>
      <div className="files-grid">
        {fileStore.items.map(item => (
          <div
            className="file-card"
            key={`${item.isDir ? 'dir' : 'file'}-${item.filename}`}
            onClick={() => {
              if (item.isDir) handleFolderClick(item.filename);
              else handleFileClick(item);
            }}
          >
            <div
              className="file-card-actions"
              onClick={e => e.stopPropagation()}
            >
              <Popconfirm
                title={
                  item.isDir
                    ? settingStore.tr(
                        'Delete this folder and all its contents?',
                      )
                    : settingStore.tr('Delete this file?')
                }
                onConfirm={() => doDelete(item.filename)}
                okText={settingStore.tr('Yes')}
                cancelText={settingStore.tr('No')}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                />
              </Popconfirm>
            </div>
            <div
              className="file-card-icon"
              style={{
                color: item.isDir
                  ? token.colorWarning
                  : getFileColor(item.mimeType),
              }}
            >
              {item.isDir ? getFolderIcon() : getFileIcon(item.mimeType)}
            </div>
            <div className="file-card-name" title={item.filename}>
              {item.filename}
            </div>
            {!item.isDir && item.size > 0 && (
              <div className="file-card-size">{formatSize(item.size)}</div>
            )}
          </div>
        ))}
      </div>
      <FilePreview
        filename={previewFilename}
        url={previewUrl}
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
      />
    </Layout>
  );
};

export default observer(Files);
