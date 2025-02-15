import { ClientEdgeProps } from '@/shared/types';
import { CloseCircleFilled } from '@ant-design/icons';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
} from '@xyflow/react';

const BasicEdge = (edge: ClientEdgeProps) => {
  const { setEdges } = useReactFlow();
  const { id, sourceX, sourceY, targetX, targetY } = edge;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        <CloseCircleFilled
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          onClick={() => {
            setEdges(es => es.filter(e => e.id !== id));
          }}
        />
      </EdgeLabelRenderer>
    </>
  );
};

export default BasicEdge;
