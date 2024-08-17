import { Context, Node } from '@/share/node';
import React, { ReactNode, useCallback, useEffect, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useStore } from '../store';
import { observer } from 'mobx-react-lite';

abstract class GUINode<Props> extends Node<Props> {
  abstract render(props: Props): ReactNode;

  protected fc?: React.FC<Props>;

  get FC(): React.FC<Props> {
    this.fc =
      this.fc ||
      observer((initialProps: Props) => {
        const ctx = useStore('about');
        const [props, setProps] = useState<Props>(initialProps);

        useEffect(() => {
          this.onExecute(ctx).then(setProps).catch(console.error);
        }, []);

        return this.render(props);
      });

    return this.fc!;
  }
}

class TestNode extends GUINode<{ title: string; count: number }> {
  onExecute(ctx: Context) {
    return new Promise<{ title: string; count: number }>(resolve =>
      setTimeout(
        () =>
          resolve({
            title: 'world',
            count: ctx.nodeCount,
          }),
        2000,
      ),
    );
  }

  render(props: { title: string; count: number }): ReactNode {
    return <div>{props.title}</div>;
  }
}

const Test = new TestNode(uuid());

export default observer(() => {
  const ctx = useStore('about');

  return (
    <>
      <button
        onClick={() => {
          ctx.addNode(Test);
        }}
      >
        Add
      </button>
      <Test.FC title="hello" count={ctx.nodeCount} />
    </>
  );
});
