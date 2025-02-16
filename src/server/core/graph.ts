import { HandleProps, HandleType, Position } from '@xyflow/react';
import EventEmitter from 'eventemitter3';

export class Slot implements HandleProps {
  name: string;

  type: HandleType;

  position: Position;

  constructor(name: string, options?: Partial<HandleProps>) {
    this.name = name;
    this.type = options?.type || 'target';
    this.position = options?.position || Position.Right;
  }
}

export class Edge {
  id: string;
  from: Slot;
  to: Slot;

  constructor(id: string, from: Slot, to: Slot) {
    if (from.type !== 'source' || to.type !== 'target') {
      throw new Error(
        `Edge must connect a source slot to a target slot, edgeId: ${id}.`,
      );
    }

    this.id = id;
    this.from = from;
    this.to = to;
  }
}

export class Node extends EventEmitter {
  id: string;
  slots: Map<string, Slot> = new Map();

  constructor(id: string) {
    super();
    this.id = id;
  }

  findSlot(event: string | symbol | Slot): Slot | undefined {
    const slot = event instanceof Slot ? event : this.slots.get(String(event));

    return slot;
  }

  getSlot(event: string | symbol | Slot): Slot {
    const slot = this.findSlot(event);

    if (!slot) {
      throw new Error(
        `Slot ${event.toString()} not found for Node(${this.id}).`,
      );
    }

    return slot;
  }

  deleteSlot(slot: Slot): boolean;
  deleteSlot(slotName: string): boolean;
  deleteSlot(param: any): boolean {
    if (param instanceof Slot) {
      return this.slots.delete(param.name);
    }

    return this.slots.delete(param);
  }

  defineSlot(
    slot: Slot,
    handler?: (...args: any[]) => void,
    ctx?: Graph,
  ): Node {
    this.slots.set(slot.name, slot);

    if (handler) {
      this.on(slot.name, handler, ctx);
    }

    return this;
  }

  emit(event: string | symbol | Slot, ...args: any[]): boolean {
    return super.emit(this.getSlot(event).name, ...args);
  }

  on(
    event: string | symbol | Slot,
    fn: (...args: any[]) => void,
    context?: Graph,
  ): this {
    return super.on(this.getSlot(event).name, fn, context);
  }

  off(
    event: string | symbol | Slot,
    fn?: ((...args: any[]) => void) | undefined,
    context?: Graph,
    once?: boolean,
  ): this {
    return super.off(this.getSlot(event).name, fn, context, once);
  }

  // once(
  //   event: string | symbol | Slot,
  //   fn: (...args: any[]) => void,
  //   context?: Graph,
  // ): this {
  //   return super.once(this.getSlot(event).name, fn, context);
  // }

  addListener(
    event: string | symbol | Slot,
    fn: (...args: any[]) => void,
    context?: Graph,
  ): this {
    return super.addListener(this.getSlot(event).name, fn, context);
  }

  removeListener(
    event: string | symbol | Slot,
    fn: (...args: any[]) => void,
    context?: Graph,
  ): this {
    return super.removeListener(this.getSlot(event).name, fn, context);
  }
}

export class Graph {
  nodes: Map<string, Node> = new Map();
  edges: Map<string, Edge> = new Map();

  // slot and its related node and edges, edges are indexed by edge id
  slotIndexMap: WeakMap<Slot, { node: Node; edges?: Map<string, Edge> }> =
    new WeakMap();

  reset(): Graph {
    this.nodes.clear();
    this.edges.clear();
    this.slotIndexMap = new WeakMap();
    return this;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  addNode(node: Node): Graph {
    this.nodes.set(node.id, node);
    node.slots.forEach(slot => {
      this.slotIndexMap.set(slot, { node });
    });
    return this;
  }

  connect(edge: Edge): Graph {
    const from = this.slotIndexMap.get(edge.from);

    if (!from) {
      throw new Error(
        `Slot ${String(edge.from.name)} for edge ${edge.id} not found.`,
      );
    }

    from.edges = from.edges || new Map();

    const to = this.slotIndexMap.get(edge.to);

    if (!to) {
      throw new Error(
        `Slot ${String(edge.to.name)} for edge ${edge.id} not found.`,
      );
    }

    to.edges = to.edges || new Map();

    from.edges.set(edge.id, edge);
    to.edges.set(edge.id, edge);
    this.edges.set(edge.id, edge);

    return this;
  }

  deleteNode(node: Node): { node: Node; edges: Edge[] };
  deleteNode(nodeId: string): { node: Node; edges: Edge[] };
  deleteNode(param: any) {
    const nodeId = param instanceof Node ? param.id : param;
    const node = this.nodes.get(nodeId);
    const collect: Edge[] = [];

    node?.slots.forEach(slot => {
      const { edges } = this.slotIndexMap.get(slot) || {};

      edges?.forEach(edge => {
        collect.push(edge);
        this.edges.delete(edge.id);
      });
      this.slotIndexMap.delete(slot);
    });
    this.nodes.delete(nodeId);

    return { node, edges: collect };
  }

  deleteEdge(edge: Edge): Edge;
  deleteEdge(edgeId: string): Edge;
  deleteEdge(param: any): Edge {
    const edgeId = param instanceof Edge ? param.id : param;
    const edge = this.edges.get(edgeId);

    if (edge) {
      const from = this.slotIndexMap.get(edge.from);

      if (from) {
        from.edges?.delete(edgeId);
      }

      const to = this.slotIndexMap.get(edge.to);

      if (to) {
        to.edges?.delete(edgeId);
      }
    }

    this.edges.delete(edgeId);
    return edge!;
  }

  deleteSlot(slot: Slot): Edge[] {
    const map = this.slotIndexMap.get(slot);
    const edges = [...(map?.edges?.values() || [])];

    if (slot.type === 'source') {
      edges.forEach(edge => {
        this.slotIndexMap.get(edge.to)?.edges?.delete(edge.id);
        this.edges.delete(edge.id);
      });
    } else {
      edges.forEach(edge => {
        this.slotIndexMap.get(edge.from)?.edges?.delete(edge.id);
        this.edges.delete(edge.id);
      });
    }

    this.getNode(slot)?.deleteSlot(slot);
    return edges;
  }

  getNode(slot: Slot): Node | undefined;
  getNode(nodeId: string): Node | undefined;
  getNode(param: any): Node | undefined {
    if (param instanceof Slot) {
      return this.slotIndexMap.get(param)?.node as Node;
    }

    return this.nodes.get(param) as Node;
  }

  getEdges(slot: Slot): Map<string, Edge> {
    return this.slotIndexMap.get(slot)?.edges || new Map();
  }

  getEdge(edgeId: string): Edge | undefined {
    return this.edges.get(edgeId);
  }
}
