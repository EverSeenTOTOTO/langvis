import { usePagination } from '@/client/hooks/usePagination';
import { useStore } from '@/client/store';
import type { EmailListItem } from '@/shared/dto/controller/email.dto';
import {
  DeleteOutlined,
  EyeOutlined,
  MailOutlined,
  PaperClipOutlined,
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

interface SearchParams {
  from?: string;
  subject?: string;
  startDate?: string;
  endDate?: string;
}

const Emails: React.FC = () => {
  const emailStore = useStore('email');
  const settingStore = useStore('setting');
  const [form] = Form.useForm();

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<NonNullable<
    typeof emailStore.currentEmail
  > | null>(null);

  const detailApi = useAsyncFn(emailStore.getEmailById.bind(emailStore));
  const deleteApi = useAsyncFn(emailStore.deleteEmail.bind(emailStore));

  const { dataSource, pagination, loading, search, reset, refresh } =
    usePagination<SearchParams, EmailListItem>(emailStore, {
      defaultPageSize: 10,
    });

  const handleSearch = () => {
    const values = form.getFieldsValue();
    const startDate = values.timeRange?.[0]?.toISOString();
    const endDate = values.timeRange?.[1]?.toISOString();

    search({
      from: values.from,
      subject: values.subject,
      startDate,
      endDate,
    });
  };

  const handleReset = () => {
    form.resetFields();
    reset();
  };

  const handleViewDetail = async (id: string) => {
    const email = await detailApi[1]({ id });
    if (email) {
      setSelectedEmail(email);
      setDetailModalOpen(true);
    }
  };

  const handleDelete = async (id: string) => {
    const success = await deleteApi[1]({ id });
    if (success) {
      refresh();
      message.success(settingStore.tr('Email deleted successfully'));
    }
  };

  const columns: ColumnsType<EmailListItem> = [
    {
      title: settingStore.tr('From'),
      dataIndex: 'from',
      key: 'from',
      width: 200,
      render: (from: string, record) => (
        <Tooltip title={record.fromName || from}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {record.fromName ? (
              <>
                <Text strong>{record.fromName}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {from}
                </Text>
              </>
            ) : (
              from
            )}
          </div>
        </Tooltip>
      ),
    },
    // {
    //   title: settingStore.tr('To'),
    //   dataIndex: 'to',
    //   key: 'to',
    //   width: 180,
    //   ellipsis: true,
    // },
    {
      title: settingStore.tr('Subject'),
      dataIndex: 'subject',
      key: 'subject',
      width: 250,
      ellipsis: true,
    },
    {
      title: settingStore.tr('Sent At'),
      dataIndex: 'sentAt',
      key: 'sentAt',
      width: 160,
      render: (date: Date) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: settingStore.tr('Received At'),
      dataIndex: 'receivedAt',
      key: 'receivedAt',
      width: 160,
      render: (date: Date) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: settingStore.tr('Attachments'),
      dataIndex: 'attachmentCount',
      key: 'attachmentCount',
      width: 110,
      align: 'center',
      render: (count: number, record) =>
        count > 0 ? (
          <Tooltip
            title={record.attachmentNames?.map((name, idx) => (
              <div key={idx}>{name}</div>
            ))}
          >
            <Tag icon={<PaperClipOutlined />} color="blue">
              {count}
            </Tag>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: settingStore.tr('Created At'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date: Date) => dayjs(date).format('YYYY-MM-DD HH:mm'),
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
            title={settingStore.tr('Delete this email?')}
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
    <Layout className="emails-page">
      <div className="emails-filter">
        <Form form={form} layout="vertical">
          <Row gutter={[16, 12]}>
            <Col span={6}>
              <Form.Item name="from">
                <Input
                  placeholder={settingStore.tr('Search by sender')}
                  onPressEnter={handleSearch}
                  prefix={<MailOutlined />}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="subject">
                <Input
                  placeholder={settingStore.tr('Search by subject')}
                  onPressEnter={handleSearch}
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
        scroll={{ x: 1300 }}
        pagination={pagination}
      />

      <Modal
        title={settingStore.tr('Email Details')}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width="75%"
        loading={detailApi[0].loading}
      >
        {selectedEmail && (
          <div className="email-detail">
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label={settingStore.tr('From')} span={2}>
                {selectedEmail.fromName ? (
                  <>
                    <Text strong>{selectedEmail.fromName}</Text>
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      &lt;{selectedEmail.from}&gt;
                    </Text>
                  </>
                ) : (
                  <Text>{selectedEmail.from}</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('To')}>
                {selectedEmail.to}
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Subject')}>
                <Text strong>{selectedEmail.subject}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Sent At')}>
                {dayjs(selectedEmail.sentAt).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Received At')}>
                {dayjs(selectedEmail.receivedAt).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label={settingStore.tr('Message ID')} span={2}>
                <Paragraph
                  copyable
                  ellipsis={{ rows: 1 }}
                  style={{ margin: 0 }}
                >
                  {selectedEmail.messageId}
                </Paragraph>
              </Descriptions.Item>
              {selectedEmail.attachmentCount > 0 && (
                <Descriptions.Item
                  label={settingStore.tr('Attachments')}
                  span={2}
                >
                  {selectedEmail.attachmentNames?.map((name, idx) => (
                    <Tag
                      key={idx}
                      icon={<PaperClipOutlined />}
                      color="blue"
                      style={{ marginBottom: 4 }}
                    >
                      {name}
                    </Tag>
                  ))}
                </Descriptions.Item>
              )}
              <Descriptions.Item label={settingStore.tr('Created At')}>
                {dayjs(selectedEmail.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
            </Descriptions>

            <div className="detail-section">
              <Title level={5}>{settingStore.tr('Content')}</Title>
              <div
                className="detail-content html-content"
                dangerouslySetInnerHTML={{ __html: selectedEmail.content }}
              />
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default observer(Emails);
