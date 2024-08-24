import { GUINode } from '@/client/components/GUINode';
import { SLOT_NAMES } from '@/client/constants';
import { useStore } from '@/client/store';
import { Button, Flex } from '@radix-ui/themes';
import { observer } from 'mobx-react-lite';
import { ReactNode, useEffect } from 'react';
import { v4 as uuid } from 'uuid';

const { UPDATE } = SLOT_NAMES;

class TestNode extends GUINode<{ title: string }> {
  render(props: { title: string; count: number }): ReactNode {
    const ctx = useStore('node');

    useEffect(() => {
      setTimeout(
        () =>
          this.emit(UPDATE, {
            title: 'world',
          }),
        2000,
      );
    }, []);

    return (
      <div>
        {props.title} {ctx.nodeCount} {ctx.edgeCount}
      </div>
    );
  }
}

const Test = new TestNode(uuid());

const a = new TestNode(uuid());
const b = new TestNode(uuid());

export default observer(() => {
  const ctx = useStore('node');

  return (
    <>
      <Flex gap="2">
        <Button
          onClick={() => {
            ctx.addNode(a);
            ctx.addNode(b);
          }}
        >
          Add
        </Button>
        <Button
          onClick={() => {
            ctx.deleteNode([...ctx.nodes.values()][0]);
          }}
        >
          Delete
        </Button>
        <Button
          onClick={() => {
            ctx.connect(uuid(), a.getSlot(UPDATE)!, b.getSlot(UPDATE)!);
          }}
        >
          connect
        </Button>
      </Flex>

      <Test.FC title="hello" />
    </>
  );
});
