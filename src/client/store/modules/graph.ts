import { Edge, Node, NodeTypes } from '@xyflow/react';
import { makeAutoObservable } from 'mobx';
import React from 'react';
import type { AppStore } from '..';

const nodeTypes = import.meta.glob('@/client/components/GUINodes/*.tsx', {
  eager: true,
}) as any;

export class GraphStore {
  root: AppStore;

  nodes: Node[] = [];

  edges: Edge[] = [];

  nodeTypes: NodeTypes = {};

  constructor(root: AppStore) {
    this.root = root;
    Object.keys(nodeTypes).forEach(path => {
      const type = path
        .match(/src\/client\/components\/GUINodes\/(.*)\.tsx$/)![1]
        .toLowerCase();

      this.registerNodeType(type, nodeTypes[path].default);
    });

    makeAutoObservable(this);
  }

  registerNodeType(type: string, component: React.FC<any>) {
    this.nodeTypes[type] = component;
  }

  unregisterNodeType(type: string) {
    delete this.nodeTypes[type];
  }
}
