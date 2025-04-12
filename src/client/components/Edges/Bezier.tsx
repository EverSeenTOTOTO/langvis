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
  const { id, sourceX, sourceY, targetX, targetY } = edge;

  const [edgePath, labelX, labelY] = getSimpleBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });
  const home = useStore('home');

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        <DropdownMenu
          trigger={['click']}
          items={[
            {
              type: 'item',
              label: setting.tr('Delete edge'),
              danger: true,
              key: 'delete',
              icon: <DeleteOutlined />,
              render: ({ dom }) => {
                return (
                  <Popconfirm
                    title={setting.tr('Sure to delete?')}
                    placement="rightTop"
                    onConfirm={async () => {
                      await home.deleteEdge({ id: edge.id });
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
          <Button
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px) scale(0.6)`,
              pointerEvents: 'all',
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

