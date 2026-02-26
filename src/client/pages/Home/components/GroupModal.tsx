import Modal, { ModalProps } from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { Form, FormProps, Input, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { useMedia } from 'react-use';

const GroupModal = ({
  title,
  children,
  initialValues,
  onFinish,
  ...props
}: Omit<ModalProps, 'title' | 'children' | 'onOk'> & {
  title: string;
  children?: React.ReactElement;
  initialValues?: FormProps['initialValues'];
  onFinish?: (values: { id?: string; name: string }) => Promise<unknown>;
}) => {
  const [form] = Form.useForm();
  const settingStore = useStore('setting');
  const isMobile = useMedia('(max-width: 768px)', false);

  return (
    <Modal
      width={isMobile ? '100%' : 400}
      title={title}
      destroyOnHidden
      okText={settingStore.tr('Save')}
      cancelText={settingStore.tr('Cancel')}
      trigger={children as React.ReactElement}
      afterOpenChange={open => {
        if (open) {
          form.setFieldsValue(initialValues);
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
        <Form.Item
          name="name"
          label={settingStore.tr('Group Name')}
          rules={[
            {
              required: true,
              message: settingStore.tr('Please enter a group name'),
            },
            {
              type: 'string',
              max: 50,
            },
          ]}
        >
          <Input placeholder={settingStore.tr('Enter group name')} />
        </Form.Item>
        <Form.Item label={settingStore.tr('Group Id')}>
          <Typography.Text type="secondary" copyable>
            {initialValues?.id}
          </Typography.Text>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default observer(GroupModal);
