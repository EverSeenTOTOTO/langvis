import Graph from '@/client/components/Graph';
import MessageViewport from '@/client/components/Message';
import { useStore } from '@/client/store';
import { EdgeChange, NodeChange } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import './index.scss';

const Home = () => {
  const graph = useStore('graph');

  return (
    <>
      <MessageViewport />
      <Graph
        onInit={flow => graph.setFlow(flow)}
        nodes={graph.nodes}
        onNodesChange={(changes: NodeChange[]) => graph.updateNodes(changes)}
        edges={graph.edges}
        onEdgesChange={(changes: EdgeChange[]) => graph.updateEdges(changes)}
        onConnect={connection => graph.connectNode(connection)}
      />
    </>
  );
};

export default observer(Home);
