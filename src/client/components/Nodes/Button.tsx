import useApi from '@/client/hooks/useApi';
import { useStore } from '@/client/store';
import { NodeInitialData } from '@/shared/entities/NodeMeta';
import { InstrinicNodeProps } from '@/shared/types';
import { BoldOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Handle } from '@xyflow/react';
import {
  Button,
  Checkbox,
  Col,
  Form,
  Input,
  Popconfirm,
  Row,
  Select,
  Switch,
  Tooltip,
} from 'antd';
import { omit } from 'lodash-es';
import { observer } from 'mobx-react-lite';
import DropdownMenu from '../Dropdown';
import Modal, { ModalProps } from '../Modal';

const EditModal = ({
  node,
  ...props
}: ModalProps & {
  node: InstrinicNodeProps['button'];
}) => {
  const [form] = Form.useForm();
  const home = useStore('home');
  const setting = useStore('setting');
  const updateNodeApi = useApi(home.updateNode.bind(home));

  return (
    <Modal
      width={460}
      title={`${node.data.name} ${setting.tr('Node Properties')}`}
      okButtonProps={{
        loading: updateNodeApi.loading,
      }}
      onOk={async () => {
        await form.validateFields();

        const values = form.getFieldsValue(true);

        await updateNodeApi.run({
          id: node.id,
          type: node.type,
          data: {
            ...values.data,
            slots: NodeInitialData[node.type as string].slots!.filter(
              (slot: { type: string }) => values.slots?.includes(slot.type),
            ),
          },
        });

        return true;
      }}
      {...props}
    >
      <Form
        layout="vertical"
        form={form}
        initialValues={{
          data: { ...node.data, type: node.data?.type ?? 'default' },
          slots: node.data?.slots?.map(slot => slot.type),
        }}
      >
        <Form.Item
          name={['data', 'name']}
          label={setting.tr('Node name')}
          rules={[{ required: true }]}
        >
          <Input allowClear />
        </Form.Item>
        <Form.Item
          name={['data', 'type']}
          label={setting.tr('Node type')}
          rules={[{ required: true }]}
        >
          <Select
            options={[
              {
                label: 'Default',
                value: 'default',
              },
              {
                label: 'Primary',
                value: 'primary',
              },
              {
                label: 'Dashed',
                value: 'dashed',
              },
              {
                label: 'Text',
                value: 'text',
              },
              {
                label: 'Link',
                value: 'link',
              },
            ]}
          />
        </Form.Item>
        <Row>
          <Col span={12}>
            <Form.Item
              name="slots"
              label={setting.tr('Node slots')}
              rules={[{ required: true }]}
            >
              <Checkbox.Group
                options={[
                  {
                    label: (
                      <Tooltip title={setting.tr('Edge ends here')}>
                        <span>Target</span>
                      </Tooltip>
                    ),
                    value: 'target',
                    disabled: true,
                  },
                  {
                    label: (
                      <Tooltip title={setting.tr('Edge starts from here')}>
                        <span>Source</span>
                      </Tooltip>
                    ),
                    value: 'source',
                  },
                ]}
              />
            </Form.Item>
          </Col>
          <Col>
            <Form.Item name={['data', 'danger']} label="Danger">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
};

const ButtonNode = (props: InstrinicNodeProps['button']) => {
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
          { type: 'divider', key: 'div' },
          {
            label: setting.tr('Add breakpoint'),
            key: 'brk',
            icon: <BoldOutlined />,
            disabled: true,
          },
        ]}
      >
        <Tooltip title={props.data.description}>
          <Button {...omit(props.data, 'graphId', 'name', 'description')}>
            {props.data.name}
          </Button>
        </Tooltip>
      </DropdownMenu>
      {props.data?.slots?.map(slot => (
        <Tooltip
          key={slot.name}
          title={
            slot.type === 'source'
              ? setting.tr('Edge starts from here')
              : setting.tr('Edge ends here')
          }
        >
          <Handle
            {...slot}
            className={
              slot.type === 'source' ? 'source-handle' : 'target-handle'
            }
          />
        </Tooltip>
      ))}
    </>
  );
};

export default observer(ButtonNode);
