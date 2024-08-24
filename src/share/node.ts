import EventEmitter from 'eventemitter3';

export class Slot {
  name: string | symbol;

  constructor(name: string | symbol) {
    this.name = name;
  }
}

export class Edge {
  id: string;
  from: Slot;
  to: Slot;

  constructor(id: string, from: Slot, to: Slot) {
    this.id = id;
    this.from = from;
    this.to = to;
  }
}

export class Context {
  nodes: Map<string, Node<unknown>> = new Map();
  edges: Map<string, Edge> = new Map();
  slotIndexMap: WeakMap<
    Slot,
    { node: Node<unknown>; edges?: Map<string | symbol, Edge> }
  > = new WeakMap();

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  addNode(node: Node<unknown>): Context {
    this.nodes.set(node.id, node);
    node.slots.forEach(slot => {
      this.slotIndexMap.set(slot, { node });
    });
    return this;
  }

  protected addEdge(edge: Edge): Context {
    const from = this.slotIndexMap.get(edge.from);

    if (!from) {
      throw new Error(
        `Slot ${String(edge.from.name)} for edge ${edge.id} not found.`,
      );
    }

    from.edges = from.edges || new Map();
    from.edges.set(edge.id, edge);

    const to = this.slotIndexMap.get(edge.to);

    if (!to) {
      throw new Error(
        `Slot ${String(edge.to.name)} for edge ${edge.id} not found.`,
      );
    }

    to.edges = to.edges || new Map();
    to.edges.set(edge.id, edge);

    this.edges.set(edge.id, edge);

    return this;
  }

  connect(edgeId: string, from: Slot, to: Slot): Context {
    const edge = new Edge(edgeId, from, to);
    this.addEdge(edge);
    return this;
  }

  deleteNode(node: Node<unknown>): Context;
  deleteNode(nodeId: string): Context;
  deleteNode(param: any): Context {
    const nodeId = param instanceof Node ? param.id : param;
    const node = this.nodes.get(nodeId);

    node?.slots.forEach(slot => {
      const { edges } = this.slotIndexMap.get(slot) || {};

      edges?.forEach(edge => {
        this.edges.delete(edge.id);
      });
      this.slotIndexMap.delete(slot);
    });
    this.nodes.delete(nodeId);

    return this;
  }

  deleteEdge(edge: Edge): Context;
  deleteEdge(edgeId: string): Context;
  deleteEdge(param: any): Context {
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
    return this;
  }

  getNode<T = void>(slot: Slot): Node<T> | undefined;
  getNode<T = void>(nodeId: string): Node<T> | undefined;
  getNode<T = void>(param: any): Node<T> | undefined {
    if (param instanceof Slot) {
      return this.slotIndexMap.get(param)?.node as Node<T>;
    }

    return this.nodes.get(param) as Node<T>;
  }

  getEdges(slot: Slot): Map<string, Edge> {
    return this.slotIndexMap.get(slot)?.edges || new Map();
  }

  getEdge(edgeId: string): Edge | undefined {
    return this.edges.get(edgeId);
  }
}

export class Node<R = void> extends EventEmitter {
  id: string;
  slots: Map<string | symbol, Slot> = new Map();

  constructor(id: string) {
    super();
    this.id = id;
  }

  getSlot(slotName: string | symbol) {
    return this.slots.get(slotName);
  }

  on(
    event: string | symbol,
    fn: (...args: any[]) => void,
    context?: Context,
  ): this {
    if (!this.slots.has(event)) {
      throw new Error(`Slot ${event.toString()} not found.`);
    }
    return super.on(event, fn, context);
  }

  off(
    event: string | symbol,
    fn?: ((...args: any[]) => void) | undefined,
    context?: Context,
    once?: boolean,
  ): this {
    if (!this.slots.has(event)) {
      throw new Error(`Slot ${event.toString()} not found.`);
    }

    return super.off(event, fn, context, once);
  }

  once(
    event: string | symbol,
    fn: (...args: any[]) => void,
    context?: Context,
  ): this {
    if (!this.slots.has(event)) {
      throw new Error(`Slot ${event.toString()} not found.`);
    }

    return super.once(event, fn, context);
  }

  addListener(
    event: string | symbol,
    fn: (...args: any[]) => void,
    context?: Context,
  ): this {
    if (!this.slots.has(event)) {
      throw new Error(`Slot ${event.toString()} not found.`);
    }

    return super.addListener(event, fn, context);
  }

  defineSlot(
    slot: Slot,
    handler?: (...args: any[]) => void,
    ctx?: Context,
  ): Node<R> {
    this.slots.set(slot.name, slot);
    if (handler) {
      this.on(slot.name, handler, ctx);
    }

    return this;
  }
}
