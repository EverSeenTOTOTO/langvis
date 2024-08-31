import Graph from '@/client/components/Graph';
import { GUINode } from '@/client/components/GUINode';
import { Button } from '@radix-ui/themes';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import './index.scss';

class TestNode extends GUINode<any> {
  render(props: any) {
    const [count, setCount] = useState(props?.data?.count ?? 0);

    return (
      <Button
        id="test"
        style={{
          width: 100,
        }}
        onClick={() => setCount(count + 1)}
      >
        {count}
      </Button>
    );
  }
}

const testNode = new TestNode('test');

const MenubarDemo = () => {
  return (
    <Graph
      nodes={[
        {
          id: 'test',
          type: testNode.id,
          position: { x: 0, y: 0 },
          data: { count: 42 },
        },
      ]}
    />
  );
};

export default observer(MenubarDemo);
