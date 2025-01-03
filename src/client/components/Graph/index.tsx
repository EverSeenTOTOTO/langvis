import { useStore } from '@/client/store';
import { Background, Controls, ReactFlow, ReactFlowProps } from '@xyflow/react';
import { observer } from 'mobx-react-lite';

function Graph(props: ReactFlowProps) {
  const graph = useStore('graph');
  const theme = useStore('theme');

  return (
    <div style={{ height: '100%' }}>
      <ReactFlow
        fitView
        nodeTypes={graph.nodeTypes}
        colorMode={theme.mode}
        {...props}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default observer(Graph);
