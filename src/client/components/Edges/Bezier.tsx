import { useStore } from '@/client/store';
import { ClientEdgeProps } from '@/shared/types';
import { BoldOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSimpleBezierPath,
} from '@xyflow/react';
import { Button, Popconfirm } from 'antd';
import DropdownMenu from '../Dropdown';

const BasicEdge = (edge: ClientEdgeProps) => {
  const setting = useStore('setting');
  const home = useStore('home');

  const { id, sourceX, sourceY, targetX, targetY, data } = edge;

  const [edgePath, labelX, labelY] = getSimpleBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} />{' '}
      <EdgeLabelRenderer>
        <DropdownMenu
          trigger={['click']}
          items={[
            {
              type: 'item',
              label: setting.tr('Delete edge'),
              key: 'delete',
              render: ({ item, setOpen }) => {
                return (
                  <Popconfirm
                    title={setting.tr('Sure to delete?')}
                    placement="rightTop"
                    onConfirm={async () => {
                      await home.deleteEdge({ id: edge.id });
                      setOpen(false);
                    }}
                    onCancel={() => setOpen(false)}
                  >
                    <Button type="text" danger icon={<DeleteOutlined />}>
                      {item.label}
                    </Button>
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
          <Button
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px) scale(0.6)`,
              visibility: data?.hover ? 'visible' : 'hidden',
              pointerEvents: 'all',
              fontSize: 12,
            }}
            className="nodrag nopan"
            shape="circle"
            size="small"
            icon={<EditOutlined />}
          />
        </DropdownMenu>
      </EdgeLabelRenderer>
    </>
  );
};

export default BasicEdge;

