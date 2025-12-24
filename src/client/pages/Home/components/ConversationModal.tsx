import Modal, { ModalProps } from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { AgentConfig, AgentConfigItem, AgentFormItem } from '@/shared/types';
import {
  Checkbox,
  Col,
  Collapse,
  Empty,
  Flex,
  Form,
  FormProps,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Switch,
  Typography,
} from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useAsyncFn, useMedia } from 'react-use';

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

  const renderFormItem = (item: AgentFormItem, children: React.ReactNode) => {
    return (
      <Form.Item
        key={JSON.stringify(item.name)}
        name={[
          'config',
          ...(Array.isArray(item.name) ? item.name : [item.name]),
        ]}
        label={item.label ? settingStore.tr(item.label?.en) : undefined}
        hidden={item.hidden}
        required={item.required}
        initialValue={item.initialValue}
        tooltip={item.tooltip?.en}
        valuePropName={item.valuePropName || 'value'}
        style={{ flex: item.flex }}
        rules={[
          {
            required: item.required,
          },
        ]}
      >
        {children}
      </Form.Item>
    );
  };

  const renderConfigItem = (item: AgentConfigItem) => {
    switch (item.type) {
      case 'select':
        return renderFormItem(
          item,
          <Select
            mode={item.mode}
            options={item.options}
            placeholder={item.placeholder}
            disabled={item.disabled}
          />,
        );
      case 'text':
        return renderFormItem(
          item,
          <Input
            placeholder={item.placeholder}
            showCount={item.showCount}
            disabled={item.disabled}
          />,
        );
      case 'checkbox-group':
        return renderFormItem(
          item,
          <Checkbox.Group options={item.options} disabled={item.disabled} />,
        );
      case 'radio-group':
        return renderFormItem(
          item,
          <Radio.Group options={item.options} disabled={item.disabled} />,
        );
      case 'switch':
        return renderFormItem(
          item,
          <Switch
            checkedChildren={item.checkedChildren}
            unCheckedChildren={item.unCheckedChildren}
            disabled={item.disabled}
          />,
        );
      case 'number':
        return renderFormItem(
          item,
          <InputNumber
            controls={item.controls}
            disabled={item.disabled}
            max={item.max}
            min={item.min}
            precision={item.precision}
            step={item.step}
            stringMode={item.stringMode}
            style={{ width: '100%' }}
          />,
        );
      case 'group':
        return (
          <Collapse
            key={JSON.stringify(item.name)}
            size="small"
            bordered={false}
            defaultActiveKey="1"
            style={{ marginBottom: 16 }}
            items={[
              {
                key: '1',
                label: item.label ? settingStore.tr(item.label?.en) : undefined,
                children: (
                  <Row gutter={12}>
                    {item.children?.map(child => (
                      <Col span={child.span} flex={child.flex} key={child.name}>
                        {renderConfigItem({
                          ...child,
                          name: [item.name, child.name],
                        })}
                      </Col>
                    ))}
                  </Row>
                ),
              },
            ]}
          />
        );
      default:
        console.warn(`Unsupport item: ${JSON.stringify(item)}`);
        return null;
    }
  };

  return (
    <Modal
      width={isMobile ? '100%' : '60%'}
      title={title}
      afterClose={() => {
        form.resetFields();
      }}
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
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Flex vertical={isMobile}>
          <div className="config-left">
            <Form.Item
              name="id"
              label={settingStore.tr('Conversation ID')}
              hidden={mode === 'create'}
              rules={[
                {
                  required: mode === 'edit',
                  message: settingStore.tr('Please enter a conversation name'),
                },
              ]}
            >
              <Input disabled />
            </Form.Item>
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
              name={['config', 'agent']}
              label={settingStore.tr('Agent')}
              initialValue={AgentIds.CHAT_AGENT}
            >
              <Select
                disabled={mode === 'edit'}
                loading={fetchAgentApi[0].loading}
                placeholder={settingStore.tr('Select an agent')}
                options={
                  fetchAgentApi[0]?.value?.map(
                    (config: AgentConfig & { id: string }) => ({
                      label: settingStore.tr(config.name.en),
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
                    {settingStore.tr(agentInfo?.description.en || '')}
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

                if (!agentInfo?.configItems?.length) {
                  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
                }

                return agentInfo?.configItems?.map(renderConfigItem);
              }}
            </Form.Item>
          </div>
        </Flex>
      </Form>
    </Modal>
  );
};

export default observer(ConversationModal);
