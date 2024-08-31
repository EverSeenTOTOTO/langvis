import { SLOT_NAMES } from '@/client/constants';
import { useStore } from '@/client/store';
import { Node, Slot } from '@/share/node';
import { observer } from 'mobx-react-lite';
import React, { ReactNode, useEffect, useState } from 'react';

const { UPDATE } = SLOT_NAMES;

export abstract class GUINode<Props> extends Node<Props> {
  abstract render(props: Props): ReactNode;

  protected fc?: React.FC<Props>;

  constructor(id: string) {
    super(id);
    this.defineSlot(new Slot(UPDATE));
    const ctx = useStore('graph');
    ctx.addNodeType(this.id, this.FC);
  }

  get FC(): React.FC<Props> {
    this.fc =
      this.fc ||
      observer((initialProps: Props) => {
        const ctx = useStore('graph');
        const [props, setProps] = useState<Props>(initialProps);

        useEffect(() => {
          ctx.addNode(this);
          this.on(UPDATE, setProps, ctx);

          return () => {
            ctx.deleteNode(this);
            this.off(UPDATE, setProps, ctx);
          };
        }, []);

        return this.render(props);
      });

    return this.fc!;
  }
}
