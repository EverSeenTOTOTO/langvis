import { Node, Slot } from '@/server/core/graph';
import { Node as XyflowNode } from '@xyflow/react';
import { ButtonProps, ImageProps, SelectProps } from 'antd';
import { NodeEntity } from './entities/Node';
import { NodeMetaName } from './entities/NodeMeta';

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

export type ClientNode<NodeData extends Record<string, unknown> = {}> = Omit<
  XyflowNode<
    NodeData &
      Pick<NodeEntity, 'name' | 'description' | 'graphId'> & {
        state: NodeState;
        slots: Slot[];
      }
  >,
  'type'
> & { type: NodeMetaName };

export abstract class ServerNode extends Node {
  type: NodeMetaName = NodeMetaName.DEFAULT;
}

export type InstrinicNodes = {
  button: ClientNode<Partial<ButtonProps>>;
  select: ClientNode<Partial<SelectProps>>;
  image: ClientNode<Partial<ImageProps>>;
};
