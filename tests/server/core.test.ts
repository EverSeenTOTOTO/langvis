import { Edge, Graph, Node, Slot } from '@/server/core/graph';
import { v4 as uuid } from 'uuid';
import { expect, it, vi } from 'vitest';

class TestNode extends Node {
  constructor(id: string, callback: () => void) {
    super(id);

    this.defineSlot(
      new Slot('from', {
        type: 'target',
      }),
      callback,
    );
    this.defineSlot(
      new Slot('to', {
        type: 'source',
      }),
    );
  }

  get from() {
    return this.slots.get('from')!;
  }

  get to() {
    return this.slots.get('to')!;
  }
}

it('test node methods', () => {
  const id = uuid();
  const fn = vi.fn();
  const node = new TestNode(id, fn);

  expect(node.id).toBe(id);
  expect(node.slots.size).toBe(2);
  expect(node.getSlot('from')).toBe(node.from);
  expect(node.getSlot(node.from)).toBe(node.from);

  node.emit('from', 42);
  expect(fn).toHaveBeenCalledWith(42);

  node.off('from', fn);
  node.addListener('from', fn);
  node.emit(node.from, 24);
  expect(fn).toHaveBeenCalledWith(24);

  node.removeListener(node.from, fn);
  node.emit('from', 42);
  node.emit('from', 42);
  node.emit('from', 42);
  node.emit('from', 42);
  node.emit(node.from, 24);
  node.emit(node.from, 24);
  node.emit(node.from, 24);
  node.emit(node.from, 24);

  expect(fn).toHaveBeenCalledTimes(2);

  node.deleteSlot('from');
  expect(node.slots.size).toBe(1);
  node.deleteSlot(node.to);
  expect(node.slots.size).toBe(0);
});

const executed = new WeakSet<Node>();

class TestGraph extends Graph {
  async run(start: Node) {
    const queue = [start];

    while (queue.length > 0) {
      const top = queue.shift()! as TestNode;

      top.emit(top.from);
      this.getEdges(top.to).forEach(edge => {
        const to = this.getNode(edge.to);

        if (to && !executed.has(to)) {
          queue.push(to);
        }
      });
    }
  }
}

it('test graph methods deleteSlot', () => {
  const graph = new TestGraph();

  const a = new TestNode('a', () => {});
  const b = new TestNode('b', () => {});

  graph.addNode(a).addNode(b);

  expect(graph.getNode(a.id)).toBe(a);
  expect(graph.getNode(uuid())).toBeUndefined();
  expect(graph.nodeCount).toBe(2);

  expect(() =>
    graph.connect(
      new Edge(
        uuid(),
        a.to,
        new Slot('demo', {
          type: 'target',
        }),
      ),
    ),
  ).toThrow();
  expect(() =>
    graph.connect(
      new Edge(uuid(), new Slot('demo', { type: 'source' }), b.from),
    ),
  ).toThrow();

  expect(() => graph.connect(new Edge(uuid(), a.from, b.from))).toThrow();
  expect(() => graph.connect(new Edge(uuid(), a.to, b.to))).toThrow();

  graph.connect(new Edge(uuid(), a.to, b.from));
  graph.connect(new Edge(uuid(), b.to, a.from));

  expect(graph.edgeCount).toBe(2);

  graph.deleteSlot(a.from);

  expect(graph.edgeCount).toBe(1);

  graph.deleteSlot(a.to);

  expect(graph.edgeCount).toBe(0);
  expect(a.from).toBeUndefined();
});

it('test graph methods deleteEdge', () => {
  const graph = new TestGraph();

  const a = new TestNode('a', () => {});
  const b = new TestNode('b', () => {});

  graph.addNode(a).addNode(b);
  const e = uuid();
  graph.connect(new Edge(e, a.to, b.from));
  graph.connect(new Edge(uuid(), b.to, a.from));

  graph.deleteEdge(graph.getEdge(e)!);

  expect(graph.edgeCount).toBe(1);
  expect(graph.getEdges(a.to).size).toBe(0);
  expect(graph.getEdges(b.from).size).toBe(0);

  graph.reset();

  expect(graph.nodeCount).toBe(0);
});

it('test graph methods deleteNode', () => {
  const graph = new TestGraph();

  const a = new TestNode('a', () => {});
  const b = new TestNode('b', () => {});

  graph.addNode(a).addNode(b);
  graph.connect(new Edge(uuid(), a.to, b.from));
  graph.connect(new Edge(uuid(), b.to, a.from));

  graph.deleteNode(a);

  expect(graph.edgeCount).toBe(0);
  expect(graph.nodeCount).toBe(1);
  expect(graph.slotIndexMap.get(a.from)).toBeUndefined();
  expect(graph.slotIndexMap.get(a.to)).toBeUndefined();
});

it('test graph runtime', async () => {
  const fn = vi.fn();

  const a = new TestNode('a', () => {
    fn('a');
    executed.add(a);
  });
  const b = new TestNode('b', () => {
    fn('b');
    executed.add(b);
  });
  const c = new TestNode('c', () => {
    fn('c');
    executed.add(c);
  });

  expect(() => a.on('demo', fn)).toThrow();

  const graph = new TestGraph();

  graph.addNode(a).addNode(b).addNode(c);
  graph.connect(new Edge(uuid(), a.to, b.from));
  graph.connect(new Edge(uuid(), b.to, c.from));
  graph.connect(new Edge(uuid(), c.to, a.from));

  await graph.run(a);

  expect(fn).toHaveBeenNthCalledWith(1, 'a');
  expect(fn).toHaveBeenNthCalledWith(2, 'b');
  expect(fn).toHaveBeenNthCalledWith(3, 'c');
});
