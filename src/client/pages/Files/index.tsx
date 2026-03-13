import { usePagination } from '@/client/hooks/usePagination';
import { useStore } from '@/client/store';
import type { FileListItem } from '@/client/store/modules/file';
import {
  DeleteOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Layout, Popconfirm, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useAsyncFn } from 'react-use';
import './index.scss';

const Files: React.FC = () => {
  const fileStore = useStore('file');
  const settingStore = useStore('setting');

  const deleteApi = useAsyncFn(fileStore.delete.bind(fileStore));

  const { dataSource, pagination, loading, refresh } = usePagination<
    { page?: number; pageSize?: number },
    FileListItem
  >(fileStore, {
    defaultPageSize: 20,
  });

  const handleDelete = async (filename: string) => {
    await deleteApi[1]({ filename });
    refresh();
    message.success(settingStore.tr('File deleted successfully'));
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const columns: ColumnsType<FileListItem> = [
    {
      title: settingStore.tr('Filename'),
      dataIndex: 'filename',
      key: 'filename',
      ellipsis: true,
      render: (filename: string) => (
        <Tooltip title={filename}>
          <span className="file-name">{filename}</span>
        </Tooltip>
      ),
    },
    {
      title: settingStore.tr('Size'),
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (size: number) => formatSize(size),
    },
    {
      title: settingStore.tr('Type'),
      dataIndex: 'mimeType',
      key: 'mimeType',
      width: 150,
      render: (mimeType: string) => <Tag color="blue">{mimeType}</Tag>,
    },
    {
      title: settingStore.tr('Created At'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: Date) => dayjs(date).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: settingStore.tr('Actions'),
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <>
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            href={record.url}
            target="_blank"
          >
            {settingStore.tr('Download')}
          </Button>
          <Popconfirm
            title={settingStore.tr('Delete this file?')}
            onConfirm={() => handleDelete(record.filename)}
            okText={settingStore.tr('Yes')}
            cancelText={settingStore.tr('No')}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {settingStore.tr('Delete')}
            </Button>
          </Popconfirm>
        </>
      ),
    },
  ];

  return (
    <Layout className="files-page">
      <div className="files-header">
        <h2>{settingStore.tr('Files')}</h2>
        <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
          {settingStore.tr('Refresh')}
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey="filename"
        loading={loading}
        pagination={pagination}
      />
    </Layout>
  );
};

export default observer(Files);
