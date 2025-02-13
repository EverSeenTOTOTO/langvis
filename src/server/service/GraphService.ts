import { ClientNode, ServerNode } from '@/shared/types';
import { Edge, Graph, Slot } from '../core/graph';
import { injectable, inject } from 'tsyringe';
import { NodeService } from './NodeService';

@injectable()
export class GraphService {
  graphs: Map<string, Graph> = new Map();

  constructor(@inject(NodeService) private nodeService?: NodeService) {}

  protected getGraph(key: string) {
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

    graph.addNode(node);
  }

  deleteNode(key: string, id: string) {
    const graph = this.getGraph(key);

    graph.deleteNode(id);
  }

  getNode(key: string, id: string) {
    const graph = this.getGraph(key);

    return graph.getNode(id);
  }

  updateNode(key: string, clientNode: ClientNode) {
    const graph = this.getGraph(key);
    const node = graph.getNode(clientNode.id) as ServerNode;

    if (!node) {
      throw new Error(`Node not found in server side: ${clientNode.id}`);
    }

    const toAdd = clientNode.data.slots.filter(
      slot => !node.findSlot(slot.name),
    );
    const toDel = [...node.slots.values()].filter(
      slot => !clientNode.data.slots.find(s => s.name === slot.name),
    );

    if (toAdd.length > 0) {
      toAdd.forEach(slot =>
        node.defineSlot(
          new Slot(slot.name, {
            position: slot.position,
            type: slot.type,
          }),
        ),
      );
    }
    if (toDel.length > 0) {
      const toDelEdges = toDel.reduce((acc, slot) => {
        node.deleteSlot(slot);
        return [...acc, ...graph.getEdges(slot).values()];
      }, [] as Edge[]);

      toDelEdges.forEach(edge => graph.deleteEdge(edge));
    }

    this.nodeService!.updateNodeDTOFromClient(node, clientNode);

    return node;
  }
}
