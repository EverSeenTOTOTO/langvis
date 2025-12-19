import Modal, { ModalProps } from '@/client/components/Modal';
import { useStore } from '@/client/store';
import {
  Checkbox,
  Form,
  FormProps,
  Input,
  Radio,
  Select,
  Switch,
  Typography,
} from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useAsyncFn } from 'react-use';
import { AgentConfigItem } from '@/shared/constants/form';

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

  const fetchAgentApi = useAsyncFn(agentStore.getAllAgent.bind(agentStore));

  useEffect(() => {
    fetchAgentApi[1]();
  }, []);

  const renderConfigItem = (item: AgentConfigItem) => {
    switch (item.type) {
      case 'select':
        return (
          <Select
            mode={item.mode}
            options={item.options}
            placeholder={item.placeholder}
            disabled={item.disabled}
          />
        );
      case 'text':
        return (
          <Input
            placeholder={item.placeholder}
            showCount={item.showCount}
            disabled={item.disabled}
          />
        );
      case 'checkbox-group':
        return (
          <Checkbox.Group options={item.options} disabled={item.disabled} />
        );
      case 'radio-group':
        return <Radio.Group options={item.options} disabled={item.disabled} />;
      case 'switch':
        return (
          <Switch
            checkedChildren={item.checkedChildren}
            unCheckedChildren={item.unCheckedChildren}
            disabled={item.disabled}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Modal
      width={460}
      afterClose={() => {
        form.resetFields();
      }}
      title={title}
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
          initialValue={fetchAgentApi[0].value?.[0]?.name}
        >
          <Select
            disabled={mode === 'edit'}
            loading={fetchAgentApi[0].loading}
            placeholder={settingStore.tr('Select an agent')}
            options={
              fetchAgentApi[0]?.value?.map(
                (agent: { name: string; description: string }) => ({
                  label: settingStore.tr(agent.name),
                  value: agent.name,
                }),
              ) || []
            }
          />
        </Form.Item>
        <Form.Item noStyle dependencies={[['config', 'agent']]}>
          {({ getFieldValue }) => {
            const agent = getFieldValue(['config', 'agent']);

            if (!agent) return null;

            const agentInfo = fetchAgentApi[0]?.value?.find(
              (a: { name: string }) => a.name === agent,
            );

            return (
              <>
                <Typography.Paragraph type="secondary">
                  {settingStore.tr(agentInfo?.description || '')}
                </Typography.Paragraph>
                {agentInfo?.configItems?.map((item: AgentConfigItem) => (
                  <Form.Item
                    key={item.name as string}
                    name={['config', item.name]}
                    label={settingStore.tr(item.label as string)}
                    hidden={item.hidden}
                    required={item.required}
                    initialValue={item.initialValue}
                    tooltip={item.tooltip}
                    valuePropName={item.valuePropName || 'value'}
                    style={{ flex: item.flex }}
                  >
                    {renderConfigItem(item)}
                  </Form.Item>
                ))}
              </>
            );
          }}
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default observer(ConversationModal);
