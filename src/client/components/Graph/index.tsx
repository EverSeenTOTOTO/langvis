import { useStore } from '@/client/store';
import { Background, Controls, ReactFlow, ReactFlowProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { observer } from 'mobx-react-lite';

function Graph(props: ReactFlowProps) {
  const graph = useStore('graph');

  return (
    <div style={{ height: '100%' }}>
      <ReactFlow nodeTypes={graph.nodeTypes} fitView {...props}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default observer(Graph);
