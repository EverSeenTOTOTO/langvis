import Graph from '@/client/components/Graph';
import { getStore } from '@/client/store';
import { ReactFlowProvider } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
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
      <DndProvider backend={HTML5Backend}>
        <Header />
        <NodeMenu />
        <Graph />
      </DndProvider>
    </ReactFlowProvider>
  );
};

export default observer(Home);
