import Graph from '@/client/components/Graph';
import { applyEdgeChanges, applyNodeChanges, addEdge } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import './index.scss';

const MenubarDemo = () => {
  const [nodes, setNodes] = useState([
    {
      id: 'btn-1',
      type: 'button',
      position: { x: 0, y: 0 },
      data: { children: 123 },
    },
    {
      id: 'btn-2',
      type: 'button',
      position: { x: 100, y: 200 },
      data: { children: 'hello' },
    },
  ]);
  const [edges, setEdges] = useState([]);

  const onNodesChange = useCallback(
    changes => setNodes(nds => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    changes => setEdges(eds => applyEdgeChanges(changes, eds)),
    [],
  );
  const onConnect = useCallback(
    params => setEdges(eds => addEdge(params, eds)),
    [],
  );

  return (
    <Graph
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={edges}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
    />
  );
};

export default observer(MenubarDemo);
