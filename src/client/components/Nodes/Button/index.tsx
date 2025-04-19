import DropdownMenu from '@/client/components/Dropdown';
import { useStore } from '@/client/store';
import { InstrinicNodeProps } from '@/shared/types';
import { BoldOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Handle } from '@xyflow/react';
import { Button, Popconfirm, Tooltip } from 'antd';
import { omit } from 'lodash-es';
import { observer } from 'mobx-react-lite';
import EditModal from './EditModal';
import { useAsyncFn } from 'react-use';

const ButtonNode = (props: InstrinicNodeProps['button']) => {
  const setting = useStore('setting');
  const home = useStore('home');
  const deleteNodeApi = useAsyncFn(home.deleteNode.bind(home));

  return (
    <>
      <DropdownMenu
        trigger={['click']}
        placement="bottomRight"
        overlayStyle={{ minWidth: 120 }}
        items={[
          {
            type: 'item',
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
            type: 'item',
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
                    await deleteNodeApi[1]({ id: props.id });
                  }}
                >
                  <span onClick={e => e.stopPropagation()}>{dom}</span>
                </Popconfirm>
              );
            },
          },
          { type: 'divider', key: 'div' },
          {
            type: 'item',
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
          <Handle {...slot} className={`${slot.type}-handle`} />
        </Tooltip>
      ))}
    </>
  );
};

export default observer(ButtonNode);
