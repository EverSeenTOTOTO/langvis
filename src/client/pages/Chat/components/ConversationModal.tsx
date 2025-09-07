import Modal, { ModalProps } from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { Form, FormProps, Input } from 'antd';
import { observer } from 'mobx-react-lite';

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
  const settingStore = useStore('setting');
  const [form] = Form.useForm();

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
      </Form>
    </Modal>
  );
};

export default observer(ConversationModal);
