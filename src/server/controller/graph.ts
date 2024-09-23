import { buildClientNode } from '@/server/core/nodes';
import { Context } from '@/server/core/context';
import { Express } from 'express';

const ctx = new Context();

export default async (app: Express) => {
  app.post('/api/graph/build', (req, res) => {
    ctx.reset();

    const body = req.body;

    for (const node of body.nodes) {
      const runtimeNode = buildClientNode(node, ctx);
      ctx.addNode(runtimeNode);
    }

    for (const edge of body.edges) {
      const from = ctx.getNode(edge.source)!;
      const to = ctx.getNode(edge.target)!;

      ctx.connect(
        edge.id,
        from.getSlot(edge.sourceHandle)!,
        to.getSlot(edge.targetHandle)!,
      );
    }

    res.json(body);
  });

  app.post('/api/graph/exec', (req, res) => {
    const { nodeId, slot, msg } = req.body;
    const node = ctx.getNode(nodeId)!;

    node.emit(slot, msg, ctx);

    res.end();
  });
};
