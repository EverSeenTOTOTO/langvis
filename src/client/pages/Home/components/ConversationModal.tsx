import Modal, { ModalProps } from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import {
  Col,
  Collapse,
  Empty,
  Flex,
  Form,
  FormProps,
  Input,
  InputNumber,
  Row,
  Select,
  Switch,
  Typography,
} from 'antd';
import type { NamePath } from 'antd/es/form/interface';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useAsyncFn, useMedia } from 'react-use';

type SchemaProperty = {
  type?: string;
  enum?: readonly string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  description?: string;
  properties?: Record<string, SchemaProperty>;
  required?: readonly string[];
};

const ConversationModal = ({
  mode,
  title,
  children,
  initialValues,
  onFinish,
  ...props
}: Omit<ModalProps, 'title' | 'children' | 'onOk'> & {
  mode: 'create' | 'edit';
  title: string;
  children?: React.ReactElement;
  initialValues?: FormProps['initialValues'];
  onFinish?: (values: any) => Promise<unknown>;
  onCancel?: () => void;
}) => {
  const [form] = Form.useForm();
  const agentStore = useStore('agent');
  const settingStore = useStore('setting');
  const isMobile = useMedia('(max-width: 768px)', false);

  const fetchAgentApi = useAsyncFn(agentStore.getAllAgent.bind(agentStore));

  useEffect(() => {
    fetchAgentApi[1]();
  }, []);

  const renderSchemaField = (
    name: NamePath,
    prop: SchemaProperty,
    isRequired: boolean,
  ) => {
    const commonProps = {
      key: JSON.stringify(name),
      name: ['config', ...(Array.isArray(name) ? name : [name])],
      label: Array.isArray(name) ? name[name.length - 1] : name,
      initialValue: prop.default,
      tooltip: prop.description,
      rules: [{ required: isRequired }],
    };

    if (prop.type === 'object' && prop.properties) {
      const requiredSet = new Set(prop.required ?? []);
      return (
        <Collapse
          key={JSON.stringify(name)}
          size="small"
          bordered={false}
          defaultActiveKey="1"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: '1',
              label: Array.isArray(name) ? name[name.length - 1] : name,
              children: (
                <Row gutter={12}>
                  {Object.entries(prop.properties).map(([key, child]) => (
                    <Col span={12} key={key}>
                      {renderSchemaField(
                        [...(Array.isArray(name) ? name : [name]), key],
                        child,
                        requiredSet.has(key),
                      )}
                    </Col>
                  ))}
                </Row>
              ),
            },
          ]}
        />
      );
    }

    if (prop.enum) {
      return (
        <Form.Item {...commonProps}>
          <Select options={prop.enum.map(v => ({ label: v, value: v }))} />
        </Form.Item>
      );
    }

    if (prop.type === 'number') {
      return (
        <Form.Item {...commonProps}>
          <InputNumber
            min={prop.minimum}
            max={prop.maximum}
            style={{ width: '100%' }}
          />
        </Form.Item>
      );
    }

    if (prop.type === 'boolean') {
      return (
        <Form.Item {...commonProps} valuePropName="checked">
          <Switch />
        </Form.Item>
      );
    }

    return (
      <Form.Item {...commonProps}>
        <Input />
      </Form.Item>
    );
  };

  const renderConfigSchema = <T,>(schema?: JSONSchemaType<T>) => {
    if (!schema?.properties) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }

    const requiredSet = new Set(schema.required ?? []);
    return Object.entries(schema.properties).map(([name, prop]) =>
      renderSchemaField(name, prop as SchemaProperty, requiredSet.has(name)),
    );
  };

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [initialValues]);

  return (
    <Modal
      width={isMobile ? '100%' : '72%'}
      title={title}
      destroyOnHidden
      okText={settingStore.tr('Save')}
      cancelText={settingStore.tr('Cancel')}
      trigger={children as React.ReactElement}
      onOk={async () => {
        await form.validateFields();
        const values = form.getFieldsValue(true);
        await onFinish?.(values);
        return true;
      }}
      {...props}
    >
      <Form form={form} layout="vertical">
        <Flex vertical={isMobile}>
          <div className="config-left">
            <Form.Item
              name="name"
              label={settingStore.tr('Conversation Name')}
              rules={[
                {
                  required: true,
                  message: settingStore.tr('Please enter a conversation name'),
                },
                {
                  type: 'string',
                  max: 20,
                },
              ]}
            >
              <Input placeholder={settingStore.tr('Enter conversation name')} />
            </Form.Item>
            <Form.Item
              label={settingStore.tr('Conversation ID')}
              hidden={mode === 'create'}
            >
              <Typography.Text type="secondary" copyable>
                {initialValues?.id}
              </Typography.Text>
            </Form.Item>
            <Form.Item
              name={['config', 'agent']}
              label={settingStore.tr('Agent')}
              initialValue={AgentIds.CHAT}
            >
              <Select
                disabled={mode === 'edit'}
                loading={fetchAgentApi[0].loading}
                placeholder={settingStore.tr('Select an agent')}
                options={
                  fetchAgentApi[0]?.value?.map(
                    (config: AgentConfig & { id: string }) => ({
                      label: settingStore.tr(config.name),
                      value: config.id,
                    }),
                  ) || []
                }
              />
            </Form.Item>
            <Form.Item noStyle dependencies={[['config', 'agent']]}>
              {({ getFieldValue }) => {
                const agent = getFieldValue(['config', 'agent']);
                if (!agent) return null;

                const agentInfo: AgentConfig = fetchAgentApi[0]?.value?.find(
                  (a: AgentConfig & { id: string }) => a.id === agent,
                );

                return (
                  <Typography.Paragraph type="secondary">
                    {settingStore.tr(agentInfo?.description || '')}
                  </Typography.Paragraph>
                );
              }}
            </Form.Item>
          </div>
          <div className="config-right">
            <Form.Item noStyle dependencies={[['config', 'agent']]}>
              {({ getFieldValue }) => {
                const agent = getFieldValue(['config', 'agent']);
                if (!agent) {
                  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
                }

                const agentInfo: AgentConfig = fetchAgentApi[0]?.value?.find(
                  (a: AgentConfig & { id: string }) => a.id === agent,
                );

                return renderConfigSchema(agentInfo?.configSchema);
              }}
            </Form.Item>
          </div>
        </Flex>
      </Form>
    </Modal>
  );
};

export default observer(ConversationModal);

