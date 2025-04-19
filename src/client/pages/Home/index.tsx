import Graph from '@/client/components/Graph';
import { getStore, useStore } from '@/client/store';
import { ReactFlowProvider } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import Header from './components/Header';
import ContextMenu from './components/NodeMenu';
import './index.scss';
import { useEffect } from 'react';

export const prefetch = async () => {
  const home = getStore('home');

  await home.fetchAvailableGraphs();
};

const Home = () => {
  const sse = useStore('sse');

  useEffect(() => {
    sse.connect();
  }, []);

  return (
    <ReactFlowProvider>
      <Header />
      <ContextMenu>
        <Graph />
      </ContextMenu>
    </ReactFlowProvider>
  );
};

export default observer(Home);
