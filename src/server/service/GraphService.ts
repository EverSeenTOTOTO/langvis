import { ClientNode } from '@/shared/types';
import { singleton } from 'tsyringe';
import { Graph, Slot } from '../core/graph';
import { ServerNode } from '../core/server-node';
import { ServerEdge } from '../core/server-edge';

@singleton()
export class GraphService {
  graphs: Map<string, Graph> = new Map();

  getGraph(key: string) {
    const graph = this.graphs.get(key);

    if (!graph) {
      throw new Error(`Graph not initialized on this session: ${key}`);
    }

    return graph;
  }

  initGraph(key: string, { nodes }: { nodes: ServerNode[] }) {
    const graph = new Graph();

    nodes.forEach(node => graph.addNode(node));
    this.graphs!.set(key, graph);
  }

  addNode(key: string, node: ServerNode) {
    const graph = this.getGraph(key);

    return graph.addNode(node);
  }

  deleteNode(key: string, id: string) {
    const graph = this.getGraph(key);

    return graph.deleteNode(id);
  }

  getNode(key: string, id: string) {
    const graph = this.getGraph(key);

    return graph.getNode(id) as ServerNode;
  }

  updateNode(key: string, clientNode: ClientNode) {
    const graph = this.getGraph(key);
    const node = graph.getNode(clientNode.id) as ServerNode;

    if (!node) {
      throw new Error(`Node not found in server side: ${clientNode.id}`);
    }

    const toAdd = clientNode.data.slots?.filter(
      slot => !node.findSlot(slot.name),
    );
    const toDel = [...node.slots.values()].filter(
      slot => !clientNode.data.slots?.find(s => s.name === slot.name),
    );

    if (toAdd && toAdd.length > 0) {
      toAdd.forEach(slot =>
        node.defineSlot(
          new Slot(slot.name, { position: slot.position, type: slot.type }),
        ),
      );
    }

    const edges: ServerEdge[] = []; // collect edges to delete

    if (toDel.length > 0) {
      toDel.forEach(each => {
        edges.push(...(graph.deleteSlot(each) as ServerEdge[]));
      });
    }

    return { node, edges };
  }

  addEdge(key: string, edge: ServerEdge) {
    const graph = this.getGraph(key);

    return graph.connect(edge);
  }

  deleteEdge(key: string, id: string) {
    const graph = this.getGraph(key);

    return graph.deleteEdge(id);
  }
}
