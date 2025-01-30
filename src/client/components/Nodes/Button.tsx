import useApi from '@/client/hooks/useApi';
import { useStore } from '@/client/store';
import { InstrinicNodes } from '@/shared/node';
import { Handle } from '@xyflow/react';
import { Button, Form, Input } from 'antd';
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
  const graph = useStore('graph');
  const setting = useStore('setting');
  const updateNodeApi = useApi(graph.updateNode.bind(graph));

  return (
    <Modal
      width={460}
      title={setting.tr('Node Properties')}
      okButtonProps={{
        loading: updateNodeApi.loading,
      }}
      onOk={async () => {
        await form.validateFields();

        await updateNodeApi.run({
          id: node.id,
          name: form.getFieldValue('name'),
        });

        return true;
      }}
      {...props}
      trigger={children}
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
