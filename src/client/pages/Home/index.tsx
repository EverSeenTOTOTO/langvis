import Graph from '@/client/components/Graph';
import { getStore } from '@/client/store';
import { ReactFlowProvider } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import Header from './components/Header';
import NodeMenu from './components/NodeMenu';
import './index.scss';

export const prefetch = async () => {
  const home = getStore('home');

  await home.fetchAvailableGraphs();
};

const Home = () => {
  return (
    <ReactFlowProvider>
      <Header />
      <NodeMenu>
        <Graph />
      </NodeMenu>
    </ReactFlowProvider>
  );
};

export default observer(Home);
