import {
  Handle,
  Edge as XyflowEdge,
  EdgeProps as XyflowEdgeProps,
  Node as XyflowNode,
  NodeProps as XyflowNodeProps,
  XYPosition,
} from '@xyflow/react';
import { ButtonProps, ImageProps, SelectProps } from 'antd';
import { EdgeEntity, EdgeMetaName } from './entities/Edge';
import { NodeEntity } from './entities/Node';
import { NodeMetaName } from './entities/NodeMeta';

export enum NodeState {
  Init = 'init',
  Building = 'building',
  Built = 'built',
  Idle = 'idle',
  Running = 'running',
  Pause = 'pause',
  Error = 'error',
  Finished = 'finished',
  Disabled = 'disabled',
}

export enum EdgeState {
  Idle = 'idle',
  Pause = 'pause',
  Error = 'error',
  Disabled = 'disabled',
}

export type Slot = Pick<Handle, 'position' | 'type'> & { name: string };

// client component props
type NodeProps<T> = XyflowNodeProps<{
  id: string;
  position: XYPosition;
  type?: NodeMetaName;
  data: T &
    Record<string, any> &
    Pick<NodeEntity, 'name' | 'description' | 'graphId'> & {
      state: NodeState;
      slots: Slot[];
    };
}>;

export type InstrinicNodeProps = {
  button: NodeProps<ButtonProps>;
  select: NodeProps<SelectProps>;
  image: NodeProps<ImageProps>;
};

// client node
type NodeBase<T> = Omit<
  XyflowNode<
    T &
      Record<string, any> &
      Pick<NodeEntity, 'name' | 'description' | 'graphId'> & {
        state: NodeState;
        slots: Slot[];
      }
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

// client props
type EdgeProps<T> = XyflowEdgeProps<{
  id: string;
  source: string;
  target: string;
  data: T & Record<string, any>;
}>;

export type InstrinicEdgeProps = {
  bezier: EdgeProps<{}>;
};

// client edge
type EdgeBase<T> = Omit<XyflowEdge<T & Record<string, any>>, 'type'> & {
  type?: EdgeMetaName;
};

export type InstrinicEdge = {
  bezier: EdgeBase<Pick<EdgeEntity, 'graphId'>>;
};

export type ClientEdgeProps = InstrinicEdgeProps[keyof InstrinicEdgeProps];
export type ClientEdge = InstrinicEdge[keyof InstrinicEdge];
