import { useStore } from '@/client/store';
import { Background, Controls, ReactFlow, ReactFlowProps } from '@xyflow/react';
import { observer } from 'mobx-react-lite';

function Graph(props: ReactFlowProps) {
  const graph = useStore('graph');
  const setting = useStore('setting');

  return (
    <ReactFlow
      fitView
      nodeTypes={graph.nodeTypes}
      colorMode={setting.mode}
      {...props}
    >
      <Background />
      <Controls position="bottom-right" />
    </ReactFlow>
  );
}

export default observer(Graph);
