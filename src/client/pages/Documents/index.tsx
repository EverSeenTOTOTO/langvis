import { useStore } from '@/client/store';
import type { DocumentListItem } from '@/shared/dto/controller/document.dto';
import type { DocumentCategory as DCType } from '@/shared/entities/Document';
import { DeleteOutlined, EyeOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useState } from 'react';
import { useAsyncFn } from 'react-use';
import './index.scss';

const { RangePicker } = DatePicker;

const CATEGORY_OPTIONS: { label: string; value: DCType }[] = [
  { label: 'Tech Blog', value: 'tech_blog' },
  { label: 'Social Media', value: 'social_media' },
  { label: 'Paper', value: 'paper' },
  { label: 'Documentation', value: 'documentation' },
  { label: 'News', value: 'news' },
  { label: 'Other', value: 'other' },
];

const CATEGORY_LABELS: Record<DCType, string> = {
  tech_blog: 'Tech Blog',
  social_media: 'Social Media',
  paper: 'Paper',
  documentation: 'Documentation',
  news: 'News',
  other: 'Other',
};

const Documents: React.FC = () => {
  const documentStore = useStore('document');
  const settingStore = useStore('setting');

  const [keyword, setKeyword] = useState(documentStore.keyword);
  const [category, setCategory] = useState<DCType | undefined>(
    documentStore.category,
  );
  const [timeRange, setTimeRange] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(
    documentStore.startTime && documentStore.endTime
      ? [dayjs(documentStore.startTime), dayjs(documentStore.endTime)]
      : null,
  );

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<NonNullable<
    typeof documentStore.currentDocument
  > | null>(null);

  const listApi = useAsyncFn(documentStore.listDocuments.bind(documentStore));
  const detailApi = useAsyncFn(
    documentStore.getDocumentById.bind(documentStore),
  );
  const deleteApi = useAsyncFn(
    documentStore.deleteDocument.bind(documentStore),
  );

  const fetchDocuments = useCallback(async () => {
    await listApi[1]({
      keyword: documentStore.keyword || undefined,
      category: documentStore.category,
      startTime: documentStore.startTime,
      endTime: documentStore.endTime,
      page: 1,
      pageSize: 10,
    });
  }, [listApi, documentStore]);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleSearch = () => {
    documentStore.setKeyword(keyword);
    documentStore.setCategory(category);
    if (timeRange && timeRange[0] && timeRange[1]) {
      documentStore.setTimeRange(
        timeRange[0].toISOString(),
        timeRange[1].toISOString(),
      );
    } else {
      documentStore.setTimeRange(undefined, undefined);
    }
    fetchDocuments();
  };

  const handleReset = () => {
    setKeyword('');
    setCategory(undefined);
    setTimeRange(null);
    documentStore.resetFilters();
    fetchDocuments();
  };

  const handleViewDetail = async (id: string) => {
    const doc = await detailApi[1]({ id });
    if (doc) {
      setSelectedDocument(doc);
      setDetailModalOpen(true);
    }
  };

  const handleDelete = async (id: string) => {
    const success = await deleteApi[1]({ id });
    if (success) {
      message.success(settingStore.tr('Document deleted successfully'));
      fetchDocuments();
    }
  };

  const handleTableChange = async (page: number, pageSize: number) => {
    await listApi[1]({
      keyword: documentStore.keyword || undefined,
      category: documentStore.category,
      startTime: documentStore.startTime,
      endTime: documentStore.endTime,
      page,
      pageSize,
    });
  };

  const columns: ColumnsType<DocumentListItem> = [
    {
      title: settingStore.tr('Title'),
      dataIndex: 'title',
      key: 'title',
      width: 200,
      ellipsis: true,
    },
    {
      title: settingStore.tr('Summary'),
      dataIndex: 'summary',
      key: 'summary',
      width: 300,
      render: (text: string | null) => (
        <Tooltip title={text}>
          <div
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {text || '-'}
          </div>
        </Tooltip>
      ),
    },
    {
      title: settingStore.tr('Category'),
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (cat: DCType) => (
        <Tag>{settingStore.tr(CATEGORY_LABELS[cat])}</Tag>
      ),
    },
    {
      title: settingStore.tr('Keywords'),
      dataIndex: 'keywords',
      key: 'keywords',
      width: 200,
      render: (keywords: string[]) => (
        <Tooltip title={keywords.join(', ')}>
          <div
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {keywords.slice(0, 3).map(kw => (
              <Tag key={kw} style={{ marginBottom: 2 }}>
                {kw}
              </Tag>
            ))}
            {keywords.length > 3 && `+${keywords.length - 3}`}
          </div>
        </Tooltip>
      ),
    },
    {
      title: settingStore.tr('Source Type'),
      dataIndex: 'sourceType',
      key: 'sourceType',
      width: 100,
      render: (type: string | null) => (type ? settingStore.tr(type) : '-'),
    },
    {
      title: settingStore.tr('Source URL'),
      dataIndex: 'sourceUrl',
      key: 'sourceUrl',
      width: 150,
      ellipsis: true,
      render: (url: string | null) =>
        url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        ) : (
          '-'
        ),
    },
    {
      title: settingStore.tr('Created At'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: Date) => dayjs(date).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: settingStore.tr('Updated At'),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (date: Date) => dayjs(date).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: settingStore.tr('Actions'),
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          />
          <Popconfirm
            title={settingStore.tr(
              'Delete this document? This will cascade delete all embedding chunks.',
            )}
            onConfirm={() => handleDelete(record.id)}
            okText={settingStore.tr('Yes')}
            cancelText={settingStore.tr('No')}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="documents-page">
      <div className="documents-filter">
        <Space wrap>
          <Input
            placeholder={settingStore.tr('Search by keyword')}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            style={{ width: 200 }}
            onPressEnter={handleSearch}
          />
          <Select
            placeholder={settingStore.tr('Category')}
            value={category}
            onChange={setCategory}
            allowClear
            style={{ width: 150 }}
            options={CATEGORY_OPTIONS}
          />
          <RangePicker value={timeRange} onChange={setTimeRange} showTime />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={handleSearch}
            loading={listApi[0].loading}
          >
            {settingStore.tr('Search')}
          </Button>
          <Button onClick={handleReset}>{settingStore.tr('Reset')}</Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={documentStore.documents.items}
        rowKey="id"
        loading={listApi[0].loading}
        scroll={{ x: 1500 }}
        pagination={{
          current: documentStore.documents.page,
          pageSize: documentStore.documents.pageSize,
          total: documentStore.documents.total,
          showSizeChanger: true,
          showTotal: total => `Total ${total} items`,
          onChange: handleTableChange,
        }}
      />

      <Modal
        title={settingStore.tr('Document Details')}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={800}
        loading={detailApi[0].loading}
      >
        {selectedDocument && (
          <div className="document-detail">
            <div className="detail-row">
              <label>{settingStore.tr('Title')}:</label>
              <span>{selectedDocument.title}</span>
            </div>
            <div className="detail-row">
              <label>{settingStore.tr('Category')}:</label>
              <Tag>
                {settingStore.tr(CATEGORY_LABELS[selectedDocument.category])}
              </Tag>
              <label style={{ marginLeft: 24 }}>
                {settingStore.tr('Source Type')}:
              </label>
              <span>
                {selectedDocument.sourceType
                  ? settingStore.tr(selectedDocument.sourceType)
                  : '-'}
              </span>
            </div>
            {selectedDocument.sourceUrl && (
              <div className="detail-row">
                <label>{settingStore.tr('Source URL')}:</label>
                <a
                  href={selectedDocument.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedDocument.sourceUrl}
                </a>
              </div>
            )}
            <div className="detail-row">
              <label>{settingStore.tr('Keywords')}:</label>
              <span>
                {selectedDocument.keywords.map(kw => (
                  <Tag key={kw}>{kw}</Tag>
                ))}
              </span>
            </div>
            <div className="detail-row">
              <label>{settingStore.tr('Created At')}:</label>
              <span>
                {dayjs(selectedDocument.createdAt).format(
                  'YYYY-MM-DD HH:mm:ss',
                )}
              </span>
              <label style={{ marginLeft: 24 }}>
                {settingStore.tr('Updated At')}:
              </label>
              <span>
                {dayjs(selectedDocument.updatedAt).format(
                  'YYYY-MM-DD HH:mm:ss',
                )}
              </span>
            </div>
            <div className="detail-row">
              <label>{settingStore.tr('Chunk Count')}:</label>
              <span>{selectedDocument.chunkCount}</span>
            </div>
            <div className="detail-section">
              <label>{settingStore.tr('Summary')}:</label>
              <div className="detail-content">
                {selectedDocument.summary || '-'}
              </div>
            </div>
            <div className="detail-section">
              <label>{settingStore.tr('Raw Content')}:</label>
              <div className="detail-content scrollable">
                <pre>{selectedDocument.rawContent}</pre>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default observer(Documents);
