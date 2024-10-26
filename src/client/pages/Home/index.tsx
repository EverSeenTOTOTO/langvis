import Graph from '@/client/components/Graph';
import MessageViewport from '@/client/components/Message';
import { getStore, useStore } from '@/client/store';
import { Button, Flex, Text } from '@radix-ui/themes';
import { EdgeChange, NodeChange } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import './index.scss';

export const prefetch = () => {
  const home = getStore('home');

  return home.test();
};

const Home = () => {
  const graph = useStore('graph');
  const home = useStore('home');

  return (
    <>
      <MessageViewport />
      <Button
        onClick={() => {
          home.test();
        }}
      >
        Click me
      </Button>
      <Graph
        onInit={flow => graph.initFlow(flow)}
        nodes={graph.nodes}
        onNodesChange={(changes: NodeChange[]) => graph.updateNodes(changes)}
        edges={graph.edges}
        onEdgesChange={(changes: EdgeChange[]) => graph.updateEdges(changes)}
        onConnect={connection => graph.connectNode(connection)}
      />
      <Flex gap="4" style={{ position: 'fixed', top: 100, right: 100 }}>
        {home.countries.map(country => (
          <Text key={country.id}>{country.name}</Text>
        ))}
      </Flex>
    </>
  );
};

export default observer(Home);
