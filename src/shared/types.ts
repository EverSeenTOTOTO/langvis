import { Edge, Node, Slot } from '@/server/core/graph';
import {
  Node as XyflowNode,
  Edge as XyflowEdge,
  NodeProps as XyflowNodeProps,
  EdgeProps as XyflowEdgeProps,
  XYPosition,
} from '@xyflow/react';
import { ButtonProps, ImageProps, SelectProps } from 'antd';
import { EdgeMetaName } from './entities/EdgeMeta';
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

type NodeProps<T extends Record<string, any>> = XyflowNodeProps<{
  id: string;
  position: XYPosition;
  type?: NodeMetaName;
  data: T &
    Pick<NodeEntity, 'name' | 'description' | 'graphId'> & {
      state: NodeState;
      slots: Slot[];
    } & Record<string, any>;
}>;

export type InstrinicNodeProps = {
  button: NodeProps<ButtonProps>;
  select: NodeProps<SelectProps>;
  image: NodeProps<ImageProps>;
};

type NodeBase<T extends Record<string, any>> = Omit<
  XyflowNode<
    T &
      Pick<NodeEntity, 'name' | 'description' | 'graphId'> & {
        state: NodeState;
        slots: Slot[];
      } & Record<string, any>
  >,
  'type'
> & { type?: NodeMetaName };

export type InstrinicNode = {
  button: NodeBase<ButtonProps>;
  select: NodeBase<SelectProps>;
  image: NodeBase<ImageProps>;
};

export type ClientNodeProps = InstrinicNodeProps[keyof InstrinicNodeProps];
export type ClientNode = InstrinicNode[keyof InstrinicNode];

export abstract class ServerNode extends Node {
  type: NodeMetaName = NodeMetaName.DEFAULT;
}

type EdgeProps<T> = XyflowEdgeProps<{
  id: string;
  source: string;
  target: string;
  data: T & Record<string, any>;
}>;

export type InstrinicEdgeProps = {
  bezier: EdgeProps<{}>;
};

type EdgeBase<T> = Omit<XyflowEdge<T & Record<string, any>>, 'type'> & {
  type?: EdgeMetaName;
};

export type InstrinicEdge = {
  bezier: EdgeBase<{}>;
};

export type ClientEdgeProps = InstrinicEdgeProps[keyof InstrinicEdgeProps];
export type ClientEdge = InstrinicEdge[keyof InstrinicEdge];

export abstract class ServerEdge extends Edge {
  type: EdgeMetaName = EdgeMetaName.BEZIER;
}
