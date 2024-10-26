import { useStore } from '@/client/store';
import { ReactFlow, Controls, Background, ReactFlowProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { observer } from 'mobx-react-lite';

function Graph(props: ReactFlowProps) {
  const ctx = useStore('graph');

  return (
    <div style={{ height: '100%' }}>
      <ReactFlow nodeTypes={ctx.nodeTypes} fitView {...props}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default observer(Graph);
