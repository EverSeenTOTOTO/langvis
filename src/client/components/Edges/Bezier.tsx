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

const getEdgePath = (
  edge: ClientEdgeProps,
): ReturnType<typeof getSimpleBezierPath> => {
  const { sourceX, sourceY, targetX, targetY } = edge;

  if (edge.source === edge.target) {
    // Create a symmetric half circle for self-referencing edges
    const radius = 72;
    const startX = sourceX;
    const startY = sourceY;
    const endX = targetX;
    const endY = targetY;

    // Calculate the center of the arc above the node
    const centerX = (startX + endX) / 2;
    const centerY = Math.min(startY, endY) - radius;

    // cubic
    const path = `M ${startX} ${startY} C ${startX} ${centerY}, ${endX} ${centerY}, ${endX} ${endY}`;

    // Position the label directly on the curve for better alignment
    const labelX = centerX;
    const labelY = centerY + radius * 0.2; // Adjust label position proportional to the radius
    const offsetX = 0;
    const offsetY = 0;

    return [path, labelX, labelY, offsetX, offsetY];
  } else {
    return getSimpleBezierPath({
      sourceX: sourceX,
      sourceY: sourceY,
      targetX: targetX,
      targetY: targetY,
    });
  }
};

const BasicEdge = (edge: ClientEdgeProps) => {
  const setting = useStore('setting');
  const home = useStore('home');

  const { id, data } = edge;

  const [edgePath, labelX, labelY] = getEdgePath(edge);

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

