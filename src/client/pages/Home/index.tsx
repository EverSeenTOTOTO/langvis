import Graph from '@/client/components/Graph';
import { getStore } from '@/client/store';
import { ReactFlowProvider } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import Header from './components/Header';
import './index.scss';
import NodeMenuDropDown from './components/NodeMenu';

export const prefetch = async () => {
  const home = getStore('home');

  await home.fetchAvailableGraphs();
};

const Home = () => {
  return (
    <ReactFlowProvider>
      <Header />
      <NodeMenuDropDown trigger={['contextMenu']}>
        <Graph />
      </NodeMenuDropDown>
    </ReactFlowProvider>
  );
};

export default observer(Home);

