import { Slot } from '@/server/core/graph';
import { ButtonProps } from 'antd';
import { Node as XyflowNode } from '@xyflow/react';

export enum NodeState {
  Idle = 'idle',
  Built = 'built',
  Running = 'running',
  Error = 'error',
  Finished = 'finished',
  Disabled = 'disabled',
}

export type Layout = 'vertical' | 'horizontal';

export type ClientNode<NodeData extends Record<string, unknown> = {}> =
  XyflowNode<
    {
      state?: NodeState;
      slots?: Slot[];
    } & NodeData
  >;

export type InstrinicNodes = {
  button: ClientNode<
    { layout?: Layout; text: string } & Pick<ButtonProps, 'loading'>
  >;
};

export type ServerNode = Pick<ClientNode, 'id' | 'type' | 'position'> & {
  toClient(): ClientNode;
};
