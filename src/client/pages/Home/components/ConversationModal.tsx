import InlineItem from '@/client/components/InlineItem';
import Modal, { ModalProps } from '@/client/components/Modal';
import SchemaField, { SchemaProperty } from '@/client/components/SchemaField';
import { useStore } from '@/client/store';
import { AgentIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import {
  Empty,
  Flex,
  Form,
  FormProps,
  Input,
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
  const groupStore = useStore('conversationGroup');
  const isMobile = useMedia('(max-width: 768px)', false);

  const fetchAgentApi = useAsyncFn(agentStore.getAllAgent.bind(agentStore));
  const fetchGroupsApi = useAsyncFn(groupStore.getAllGroups.bind(groupStore));

  const renderConfigSchema = <T,>(schema?: JSONSchemaType<T>) => {
    if (!schema?.properties) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }

    const requiredSet = new Set(schema.required ?? []);
    return Object.entries(schema.properties).map(([name, prop]) => (
      <SchemaField
        key={name}
        name={name}
        prop={prop as SchemaProperty}
        required={requiredSet.has(name)}
        namePrefix={['config']}
        grid
      />
    ));
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
      afterOpenChange={open => {
        if (open) {
          fetchAgentApi[1]();
          fetchGroupsApi[1]();
        }
      }}
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

            <InlineItem label={settingStore.tr('Group')} name="groupName">
              {({ value, onChange }) => (
                <Select
                  mode="tags"
                  maxCount={1}
                  loading={fetchGroupsApi[0].loading}
                  placeholder={settingStore.tr('Select or create a group')}
                  options={groupStore.groups.map(g => ({
                    label: g.name,
                    value: g.name,
                  }))}
                  value={value ? [value] : []}
                  onChange={vals => onChange?.(vals[0])}
                />
              )}
            </InlineItem>

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

            {mode === 'create' && (
              <Form.Item
                name="switchToNew"
                label={settingStore.tr('Switch to new conversation')}
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>
            )}
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
