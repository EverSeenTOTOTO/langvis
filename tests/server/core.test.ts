import { it, expect, vi } from 'vitest';
import { v4 as uuid } from 'uuid';
import { Graph, Node, Slot } from '@/server/core/graph';

class TestNode extends Node {
  constructor(id: string, callback: () => void) {
    super(id);

    this.defineSlot(new Slot('slot'), callback);
  }

  get slot() {
    return this.slots.get('slot')!;
  }
}

it('test node methods', () => {
  const id = uuid();
  const fn = vi.fn();
  const node = new TestNode(id, fn);

  expect(node.id).toBe(id);
  expect(node.getSlot('slot')).toBe(node.slot);
  expect(node.getSlot(node.slot)).toBe(node.slot);

  node.emit('slot', 42);
  expect(fn).toHaveBeenCalledWith(42);

  node.off('slot', fn);
  node.addListener('slot', fn);
  node.emit(node.slot, 24);
  expect(fn).toHaveBeenCalledWith(24);

  node.removeListener(node.slot, fn);
  node.emit('slot', 42);
  node.emit('slot', 42);
  node.emit('slot', 42);
  node.emit('slot', 42);
  node.emit(node.slot, 24);
  node.emit(node.slot, 24);
  node.emit(node.slot, 24);
  node.emit(node.slot, 24);

  expect(fn).toHaveBeenCalledTimes(2);
});

const executed = new WeakSet<Node>();

class TestGraph extends Graph {
  async run(start: Node) {
    const queue = [start];

    while (queue.length > 0) {
      const top = queue.shift()!;

      top.emit('slot');

      top.slots.forEach(slot => {
        this.getEdges(slot).forEach(edge => {
          const to = this.getNode(edge.to);

          if (to && !executed.has(to)) {
            queue.push(to);
          }
        });
      });
    }
  }
}

it('test graph methods', () => {
  const graph = new TestGraph();

  const a = new TestNode('a', () => {});
  const b = new TestNode('b', () => {});

  graph.addNode(a).addNode(b);

  expect(graph.getNode(a.id)).toBe(a);
  expect(graph.getNode(uuid())).toBeUndefined();
  expect(graph.nodeCount).toBe(2);

  expect(() => graph.connect(uuid(), a.slot, new Slot('demo'))).toThrow();
  expect(() => graph.connect(uuid(), new Slot('demo'), b.slot)).toThrow();

  graph.connect(uuid(), a.slot, b.slot);

  expect(graph.edgeCount).toBe(1);

  graph.connect(uuid(), a.slot, b.slot);
  graph.connect(uuid(), b.slot, a.slot);

  expect(graph.edgeCount).toBe(3);

  const outputEdges = graph.getOutputEdges(b.slot);

  expect(outputEdges.length).toBe(1);
  expect(graph.getEdge(outputEdges[0].id)).toBe(outputEdges[0]);
  graph.deleteEdge(outputEdges[0]);
  expect(graph.edgeCount).toBe(2);

  graph.deleteNode(a);
  expect(graph.nodeCount).toBe(1);
  expect(graph.edgeCount).toBe(0);

  graph.reset();
  expect(graph.nodeCount).toBe(0);
});

it('test graph op', async () => {
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
  graph.connect(uuid(), a.slot, b.slot);
  graph.connect(uuid(), b.slot, c.slot);
  const ac = uuid();
  graph.connect(ac, c.slot, a.slot);

  await graph.run(a);

  expect(fn).toHaveBeenNthCalledWith(1, 'a');
  expect(fn).toHaveBeenNthCalledWith(2, 'b');
  expect(fn).toHaveBeenNthCalledWith(3, 'c');
});
