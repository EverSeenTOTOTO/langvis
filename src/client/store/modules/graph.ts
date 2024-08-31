import React from 'react';
import { Context } from '@/share/node';
import { action, computed, makeObservable, observable } from 'mobx';
import type { AppStore } from '..';
import { NodeTypes } from '@xyflow/react';

export class GraphStore extends Context {
  root: AppStore;

  nodeTypes: NodeTypes = {};

  constructor(root: AppStore) {
    super();
    this.root = root;
    this.nodes = observable.map(this.nodes, { deep: false });
    this.edges = observable.map(this.edges, { deep: false });

    makeObservable(this, {
      nodeTypes: observable,
      nodeCount: computed,
      edgeCount: computed,
      addNode: action,
      connect: action,
      deleteNode: action,
      deleteEdge: action,
    });
  }

  addNodeType(type: string, component: React.FC<any>) {
    this.nodeTypes[type] = component;
  }

  deleteNodeType(type: string) {
    delete this.nodeTypes[type];
  }
}
