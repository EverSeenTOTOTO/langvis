import { Slot } from '@/server/core/graph';
import { Node as XyflowNode } from '@xyflow/react';
import { ButtonProps, SelectProps } from 'antd';
import { NodeEntity } from './entities/Node';

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
    NodeData & {
      state?: NodeState;
      slots?: Slot[];
      layout?: Layout;
    }
  >;

export type ServerNode = {
  entity: NodeEntity;
  state?: NodeState;
  layout?: Layout;
};

export type InstrinicNodes = {
  button: ClientNode<Partial<ButtonProps>>;
  select: ClientNode<Partial<SelectProps>>;
};
