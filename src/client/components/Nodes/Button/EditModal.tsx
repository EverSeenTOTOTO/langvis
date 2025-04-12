import Modal, { ModalProps } from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { NodeInitialData } from '@/shared/entities/NodeMeta';
import { InstrinicNodeProps, Slot } from '@/shared/types';
import {
  Checkbox,
  CheckboxProps,
  Col,
  Form,
  Input,
  Row,
  Select,
  Switch,
  Tooltip,
} from 'antd';
import { useAsyncFn } from 'react-use';

const SlotCheckbox: React.FC<
  Omit<CheckboxProps, 'value' | 'onChange'> & {
    value?: Slot[];
    onChange?: (value?: Slot[]) => void;
  }
> = ({ value, onChange, ...props }) => {
  const setting = useStore('setting');

  return (
    <Checkbox.Group
      value={value?.map(slot => slot.type)}
      onChange={(checkedValues: string[]) => {
        const slots = checkedValues
          .map(
            type => NodeInitialData.button.slots!.find(s => s.type === type)!,
          )
          .filter(Boolean);
        onChange?.(slots);
      }}
      options={[
        {
          label: (
            <Tooltip title={setting.tr('Edge ends here')}>
              <span>Target</span>
            </Tooltip>
          ),
          value: 'target',
        },
        {
          label: (
            <Tooltip title={setting.tr('Edge starts from here')}>
              <span>Source</span>
            </Tooltip>
          ),
          value: 'source',
          disabled: true,
        },
      ]}
      {...props}
    />
  );
};

const EditModal = ({
  node,
  ...props
}: ModalProps & {
  node: InstrinicNodeProps['button'];
}) => {
  const [form] = Form.useForm();
  const home = useStore('home');
  const setting = useStore('setting');
  const updateNodeApi = useAsyncFn(home.updateNode.bind(home));

  return (
    <Modal
      width={460}
      title={`${node.data.name} ${setting.tr('Node Properties')}`}
      okButtonProps={{
        loading: updateNodeApi[0].loading,
      }}
      onOk={async () => {
        await form.validateFields();

        const values = form.getFieldsValue(true);

        await updateNodeApi[1]({
          id: node.id,
          type: node.type,
          data: values,
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
        <Form.Item
          name="type"
          label={setting.tr('Node type')}
          rules={[{ required: true }]}
          initialValue="default"
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
              <SlotCheckbox />
            </Form.Item>
          </Col>
          <Col>
            <Form.Item name="danger" label="Danger">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
};

export default EditModal;
