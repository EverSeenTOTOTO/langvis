import Modal, { ModalProps } from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { Form, FormProps, Input, Select, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useAsyncFn } from 'react-use';

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
  const agentStore = useStore('agent');
  const settingStore = useStore('setting');
  const [form] = Form.useForm();

  const fetchAgentApi = useAsyncFn(agentStore.getAllAgent.bind(agentStore));

  useEffect(() => {
    fetchAgentApi[1]();
  }, []);

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
        <Form.Item name={['config', 'agent']} label={settingStore.tr('Agent')}>
          <Select
            loading={fetchAgentApi[0].loading}
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

            return (
              <Typography.Paragraph type="secondary">
                {settingStore.tr(
                  fetchAgentApi[0]?.value?.find(
                    (a: { name: string }) => a.name === agent,
                  )?.description || '',
                )}
              </Typography.Paragraph>
            );
          }}
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default observer(ConversationModal);
