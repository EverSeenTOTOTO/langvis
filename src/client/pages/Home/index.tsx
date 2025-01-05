import Graph from '@/client/components/Graph';
import MessageViewport from '@/client/components/Message';
import { useStore } from '@/client/store';
import { EdgeChange, NodeChange } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import './index.scss';

const Home = () => {
  const graph = useStore('graph');
  const home = useStore('home');

  useEffect(() => {
    home.test();
  }, []);

  return (
    <>
      <MessageViewport />
      <Graph
        fitView
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
