import { useStore } from '@/client/store';
import { InstrinicNodes } from '@/shared/node';
import { Handle } from '@xyflow/react';
import { Button, Form, Input } from 'antd';
import { observer } from 'mobx-react-lite';
import Modal from '../Modal';

const ButtonNode = (props: InstrinicNodes['button']) => {
  const [form] = Form.useForm();
  const graph = useStore('graph');

  return (
    <>
      <Modal
        width={460}
        title="节点属性"
        trigger={<Button {...props.data}>{props.data.name}</Button>}
        onOk={async () => {
          await form.validateFields();

          await graph.updateNode({
            id: Number(props.id),
            name: form.getFieldValue('name'),
          });

          return true;
        }}
      >
        <Form layout="vertical" form={form} initialValues={props.data}>
          <Form.Item name="name" label="节点名称" rules={[{ required: true }]}>
            <Input allowClear />
          </Form.Item>
        </Form>
      </Modal>
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
