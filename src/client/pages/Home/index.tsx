import Graph from '@/client/components/Graph';
import { useStore } from '@/client/store';
import { Button, Flex } from '@radix-ui/themes';
import { EdgeChange, NodeChange } from '@xyflow/react';
import { observer } from 'mobx-react-lite';
import './index.scss';

const Home = () => {
  const ctx = useStore('graph');

  return (
    <>
      <Graph
        onInit={flow => ctx.initFlow(flow)}
        nodes={ctx.nodes}
        onNodesChange={(changes: NodeChange[]) => ctx.updateNodes(changes)}
        edges={ctx.edges}
        onEdgesChange={(changes: EdgeChange[]) => ctx.updateEdges(changes)}
        onConnect={connection => ctx.connectNode(connection)}
      />
      <Flex gap="4" style={{ position: 'fixed', top: 100, right: 100 }}>
        <Button
          onClick={() => {
            ctx.buildGraph();
          }}
        >
          Build
        </Button>
        <Button
          onClick={() => {
            ctx.executeGraph();
          }}
        >
          Test
        </Button>
      </Flex>
    </>
  );
};

export default observer(Home);
