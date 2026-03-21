import { lazy, Suspense } from 'react';
import { usePagination } from '@/client/hooks/usePagination';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { useStore } from '@/client/store';
import type { DocumentListItem } from '@/shared/dto/controller/document.dto';
import type { DocumentCategory as DCType } from '@/shared/entities/Document';
import {
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Button,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Layout,
  Modal,
  Popconfirm,
  Row,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAsyncFn } from 'react-use';
import './index.scss';

const { RangePicker } = DatePicker;
const { Text, Paragraph, Title } = Typography;

const CATEGORY_OPTIONS: { label: string; value: DCType }[] = [
  { label: 'Tech Blog', value: 'tech_blog' },
  { label: 'Social Media', value: 'social_media' },
  { label: 'Paper', value: 'paper' },
  { label: 'Documentation', value: 'documentation' },
  { label: 'News', value: 'news' },
  { label: 'Other', value: 'other' },
];

const CATEGORY_COLORS: Record<DCType, string> = {
  tech_blog: 'blue',
  social_media: 'magenta',
  paper: 'green',
  documentation: 'purple',
  news: 'orange',
  other: 'default',
};

const CATEGORY_LABELS: Record<DCType, string> = {
  tech_blog: 'Tech Blog',
  social_media: 'Social Media',
  paper: 'Paper',
  documentation: 'Documentation',
  news: 'News',
  other: 'Other',
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  web: 'cyan',
  file: 'geekblue',
  text: 'volcano',
};

interface SearchParams {
  keyword?: string;
  category?: DCType;
  startTime?: string;
  endTime?: string;
}

const Documents: React.FC = () => {
  const documentStore = useStore('document');
  const settingStore = useStore('setting');
  const [form] = Form.useForm();

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<NonNullable<
    typeof documentStore.currentDocument
  > | null>(null);

  const detailApi = useAsyncFn(
    documentStore.getDocumentById.bind(documentStore),
  );
  const deleteApi = useAsyncFn(
    documentStore.deleteDocument.bind(documentStore),
  );

  const { dataSource, pagination, loading, search, reset, refresh } =
    usePagination<SearchParams, DocumentListItem>(documentStore, {
      defaultPageSize: 10,
    });

  const handleSearch = () => {
    const values = form.getFieldsValue();
    const startTime = values.timeRange?.[0]?.toISOString();
    const endTime = values.timeRange?.[1]?.toISOString();

    search({
      keyword: values.keyword,
      category: values.category,
      startTime,
      endTime,
    });
  };

  const handleReset = () => {
    form.resetFields();
    reset();
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
      refresh();
      message.success(settingStore.tr('Document deleted successfully'));
    }
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
        <Tag color={CATEGORY_COLORS[cat]}>
          {settingStore.tr(CATEGORY_LABELS[cat])}
        </Tag>
      ),
    },
    {
      title: settingStore.tr('Keywords'),
      dataIndex: 'keywords',
      key: 'keywords',
      width: 200,
      render: (keywords: string[]) =>
        keywords.length > 0
          ? keywords.slice(0, 3).map((kw, idx) => (
              <Tag
                key={kw}
                color={['blue', 'green', 'orange', 'purple', 'cyan'][idx % 5]}
                style={{ marginBottom: 2 }}
              >
                {kw}
              </Tag>
            ))
          : '-',
    },
    {
      title: settingStore.tr('Source Type'),
      dataIndex: 'sourceType',
      key: 'sourceType',
      width: 120,
      render: (type: string | null) =>
        type ? (
          <Tag color={SOURCE_TYPE_COLORS[type] || 'default'}>
            {settingStore.tr(type)}
          </Tag>
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
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          >
            {settingStore.tr('View')}
          </Button>
          <Popconfirm
            title={settingStore.tr(
              'Delete this document? This will cascade delete all embedding chunks.',
            )}
            onConfirm={() => handleDelete(record.id)}
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
    <Layout className="documents-page">
      <div className="documents-filter">
        <Form form={form} layout="vertical">
          <Row gutter={[16, 12]}>
            <Col span={6}>
              <Form.Item name="keyword">
                <Input
                  placeholder={settingStore.tr('Search by keyword')}
                  onPressEnter={handleSearch}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="category">
                <Select
                  placeholder={settingStore.tr('Category')}
                  allowClear
                  options={CATEGORY_OPTIONS}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="timeRange">
                <RangePicker showTime style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6} style={{ textAlign: 'right' }}>
              <Form.Item>
                <Button onClick={handleReset} icon={<ReloadOutlined />}>
                  {settingStore.tr('Reset')}
                </Button>
                <Button
                  style={{ marginInlineStart: 8 }}
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={handleSearch}
                  loading={loading}
                >
                  {settingStore.tr('Search')}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </div>

      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1500 }}
        pagination={pagination}
      />

      <Modal
        title={settingStore.tr('Document Details')}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width="75%"
        loading={detailApi[0].loading}
      >
        {selectedDocument && (
          <div className="document-detail">
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label={settingStore.tr('Title')} span={2}>
                <Text strong>{selectedDocument.title}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Category')}>
                <Tag color={CATEGORY_COLORS[selectedDocument.category]}>
                  {settingStore.tr(CATEGORY_LABELS[selectedDocument.category])}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Source Type')}>
                {selectedDocument.sourceType ? (
                  <Tag
                    color={
                      SOURCE_TYPE_COLORS[selectedDocument.sourceType] ||
                      'default'
                    }
                  >
                    {settingStore.tr(selectedDocument.sourceType)}
                  </Tag>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
              {selectedDocument.sourceUrl && (
                <Descriptions.Item
                  label={settingStore.tr('Source URL')}
                  span={2}
                >
                  <Paragraph
                    copyable
                    ellipsis={{ rows: 2, expandable: true }}
                    style={{ margin: 0 }}
                  >
                    <a
                      href={selectedDocument.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {selectedDocument.sourceUrl}
                    </a>
                  </Paragraph>
                </Descriptions.Item>
              )}
              <Descriptions.Item label={settingStore.tr('Keywords')} span={2}>
                {selectedDocument.keywords.length > 0
                  ? selectedDocument.keywords.map((kw, idx) => (
                      <Tag
                        key={kw}
                        color={
                          ['blue', 'green', 'orange', 'purple', 'cyan'][idx % 5]
                        }
                      >
                        {kw}
                      </Tag>
                    ))
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Created At')}>
                {dayjs(selectedDocument.createdAt).format(
                  'YYYY-MM-DD HH:mm:ss',
                )}
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Updated At')}>
                {dayjs(selectedDocument.updatedAt).format(
                  'YYYY-MM-DD HH:mm:ss',
                )}
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Chunk Count')}>
                <Text strong>{selectedDocument.chunkCount}</Text>
              </Descriptions.Item>
            </Descriptions>

            <div className="detail-section">
              <Title level={5}>{settingStore.tr('Summary')}</Title>
              <Paragraph
                ellipsis={{ rows: 4, expandable: true, symbol: 'more' }}
              >
                {selectedDocument.summary || '-'}
              </Paragraph>
            </div>

            <div className="detail-section">
              <Title level={5}>{settingStore.tr('Raw Content')}</Title>
              <Suspense
                fallback={
                  <Typography.Paragraph>
                    {selectedDocument.rawContent}
                  </Typography.Paragraph>
                }
              >
                <MarkdownRender>{selectedDocument.rawContent}</MarkdownRender>
              </Suspense>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default observer(Documents);
