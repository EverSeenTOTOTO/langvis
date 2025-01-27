import { Slot } from '@/server/core/graph';
import { ButtonProps, SelectProps } from 'antd';
import { Node as XyflowNode } from '@xyflow/react';

export enum NodeState {
  Init = 'init',
  Building = 'building',
  Built = 'built',
  Idle = 'idle',
  Running = 'running',
  Error = 'error',
  Finished = 'finished',
  Disabled = 'disabled',
}

export type Layout = 'vertical' | 'horizontal';

export type ClientNode<NodeData extends Record<string, unknown> = {}> =
  XyflowNode<
    {
      name?: string;
      state?: NodeState;
      slots?: Slot[];
      layout?: Layout;
    } & NodeData
  >;

export type ServerNode = Omit<ClientNode, 'data'>;

export type InstrinicNodes = {
  button: ClientNode<Partial<ButtonProps>>;
  select: ClientNode<Partial<SelectProps>>;
};
