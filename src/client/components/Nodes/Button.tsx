import useApi from '@/client/hooks/useApi';
import { useStore } from '@/client/store';
import { InstrinicNodes } from '@/shared/node';
import { Handle } from '@xyflow/react';
import { Button, Col, Form, Input, Popconfirm, Row } from 'antd';
import { observer } from 'mobx-react-lite';
import Modal, { ModalProps } from '../Modal';

const ButtonEditModal = ({
  node,
  children,
  ...props
}: Omit<ModalProps, 'children'> & {
  children?: React.ReactElement;
  node: InstrinicNodes['button'];
}) => {
  const [form] = Form.useForm();
  const home = useStore('home');
  const setting = useStore('setting');
  const updateNodeApi = useApi(home.updateNode.bind(home));
  const deleteNodeApi = useApi(home.deleteNode.bind(home));

  return (
    <Modal
      width={460}
      title={setting.tr('Node Properties')}
      onOk={async () => {
        await form.validateFields();

        await updateNodeApi.run({
          id: node.id,
          name: form.getFieldValue('name'),
        });

        return true;
      }}
      trigger={children}
      footer={({ submit, cancel }) => {
        return (
          <Row gutter={12} justify="end">
            <Col>
              <Popconfirm
                title={setting.tr('Sure to delete?')}
                onConfirm={async () => {
                  await deleteNodeApi.run({ id: node.id });
                  cancel();
                }}
              >
                <Button danger>{setting.tr('Delete')}</Button>
              </Popconfirm>
            </Col>
            <Col>
              <Button
                type="primary"
                onClick={submit}
                loading={updateNodeApi.loading}
              >
                {setting.tr('Update')}
              </Button>
            </Col>
          </Row>
        );
      }}
      {...props}
    >
      <Form layout="vertical" form={form} initialValues={node.data}>
        <Form.Item
          name="name"
          label={setting.tr('Node name')}
          rules={[{ required: true }]}
        >
          <Input allowClear />
        </Form.Item>
      </Form>
    </Modal>
  );
};

const ButtonNode = (props: InstrinicNodes['button']) => {
  return (
    <>
      <ButtonEditModal node={props}>
        <Button {...props.data}>{props.data.name}</Button>
      </ButtonEditModal>
      {props.data?.slots?.map(slot => (
        <Handle
          {...slot}
          id={slot.name}
          key={slot.name}
          style={{
            backgroundColor: slot.type === 'source' ? 'cyan' : 'yellow',
          }}
        />
      ))}
    </>
  );
};

export default observer(ButtonNode);
