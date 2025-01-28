import Graph from '@/client/components/Graph';
import { getStore, useStore } from '@/client/store';
import { EdgeChange, NodeChange, ReactFlowProvider } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import Header from './components/Header';
import './index.scss';

export const prefetch = async () => {
  const home = getStore('home');

  await home.fetchAvailableGraphs();
};

const Home = () => {
  const graph = useStore('graph');

  return (
    <ReactFlowProvider>
      <Header />
      <Graph
        fitView
        onInit={flow => graph.setFlow(flow)}
        nodes={graph.nodes}
        onNodesChange={(changes: NodeChange[]) => graph.updateNodes(changes)}
        edges={graph.edges}
        onEdgesChange={(changes: EdgeChange[]) => graph.updateEdges(changes)}
        onConnect={connection => graph.connectNode(connection)}
      />
    </ReactFlowProvider>
  );
};

export default observer(Home);
