import useApi from '@/client/hooks/useApi';
import { useStore } from '@/client/store';
import { InstrinicNodes } from '@/shared/node';
import { BoldOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Handle } from '@xyflow/react';
import { Button, Form, Input, Popconfirm } from 'antd';
import { observer } from 'mobx-react-lite';
import DropdownMenu from '../Dropdown';
import Modal, { ModalProps } from '../Modal';

const EditModal = ({
  node,
  ...props
}: ModalProps & {
  node: InstrinicNodes['button'];
}) => {
  const [form] = Form.useForm();
  const home = useStore('home');
  const setting = useStore('setting');
  const updateNodeApi = useApi(home.updateNode.bind(home));

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
  const setting = useStore('setting');
  const home = useStore('home');
  const deleteNodeApi = useApi(home.deleteNode.bind(home));

  return (
    <>
      <DropdownMenu
        trigger={['contextMenu']}
        placement="rightTop"
        items={[
          {
            label: setting.tr('Edit node'),
            key: 'edit',
            icon: <EditOutlined />,
            render: ({ dom }) => {
              return (
                <EditModal node={props} trigger={dom as React.ReactElement} />
              );
            },
          },
          {
            label: setting.tr('Delete node'),
            danger: true,
            key: 'delete',
            icon: <DeleteOutlined />,
            render: ({ dom }) => {
              return (
                <Popconfirm
                  title={setting.tr('Sure to delete?')}
                  placement="rightTop"
                  onConfirm={async () => {
                    await deleteNodeApi.run({ id: props.id });
                  }}
                >
                  <span onClick={e => e.stopPropagation()}>{dom}</span>
                </Popconfirm>
              );
            },
          },
          { type: 'divider' },
          {
            label: setting.tr('Add breakpoint'),
            key: 'add brk',
            icon: <BoldOutlined />,
            disabled: true,
          },
        ]}
      >
        <Button {...props.data}>{props.data.name}</Button>
      </DropdownMenu>
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
