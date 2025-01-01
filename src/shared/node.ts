import { Slot } from '@/server/core/context';
import { Node as ClientNodeType } from '@xyflow/react';

export enum NodeState {
  Idle = 'idle',
  Built = 'built',
  Running = 'running',
  Error = 'error',
  Finished = 'finished',
  Disabled = 'disabled',
}

export type NodeSharedData = {
  state?: NodeState;
  slots?: Slot[];
  [k: string]: unknown;
};

export type ClientNode<
  NodeData extends NodeSharedData = NodeSharedData,
  NodeType extends string = string,
> = ClientNodeType<NodeData, NodeType>;

export type ServerNode<
  NodeData extends NodeSharedData = NodeSharedData,
  NodeType extends string = string,
> = {
  toClient(): ClientNode<NodeData, NodeType>;
};
