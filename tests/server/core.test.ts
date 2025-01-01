import { it, expect, vi } from 'vitest';
import { v4 as uuid } from 'uuid';
import { Context, Node, Slot } from '@/server/core/context';

it('test graph op', async () => {
  const fn = vi.fn();
  const executed = new WeakSet<Node>();

  class TestNode extends Node {
    constructor(id: string) {
      super(id);

      this.defineSlot(new Slot('slot'), () => {
        fn(this.id);
        executed.add(this);
      });
    }

    get slot() {
      return this.slots.get('slot')!;
    }
  }

  class TestContext extends Context {
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

  const a = new TestNode('a');
  const b = new TestNode('b');
  const c = new TestNode('c');

  expect(() => a.on('demo', fn)).toThrow();

  const ctx = new TestContext();

  ctx.addNode(a).addNode(b);

  expect(ctx.getNode(a.id)).toBe(a);
  expect(ctx.getNode(c.id)).toBeUndefined();

  ctx.addNode(c);
  expect(ctx.nodeCount).toBe(3);

  ctx.connect(uuid(), a.slot, b.slot);
  ctx.connect(uuid(), b.slot, c.slot);
  const ac = uuid();
  ctx.connect(ac, c.slot, a.slot);

  expect(ctx.edgeCount).toBe(3);
  expect(ctx.getNode(a.slot)).toBe(a);
  expect(ctx.getEdges(a.slot).size).toBe(2);
  expect(ctx.getOutputEdges(a.slot).length).toBe(1);
  expect(ctx.getOutputEdges(a.slot).length).toBe(1);

  await ctx.run(a);

  expect(fn).toHaveBeenNthCalledWith(1, 'a');
  expect(fn).toHaveBeenNthCalledWith(2, 'b');
  expect(fn).toHaveBeenNthCalledWith(3, 'c');

  ctx.deleteNode(b);

  expect(ctx.nodeCount).toBe(2);
  expect(ctx.edgeCount).toBe(1);

  ctx.deleteEdge(ac);
  expect(ctx.edgeCount).toBe(0);
});
