import { v4 as uuid } from 'uuid';
import { Express } from 'express';
import { Node, Context, Slot } from '@/server/node';

const ctx = new Context();

export default async (app: Express) => {
  app.post('/api/graph/build', (req, res) => {
    ctx.reset();

    const body = req.body;
    const idMap = new Map<string, string>(); // old config id -> runtime id

    for (const node of body.nodes) {
      const id = uuid();

      idMap.set(node.id, id);
      node.data = {
        ...node.data,
        id,
      };

      const runtimeNode = new Node(id);
      const input = new Slot('input');
      const output = new Slot('output');

      runtimeNode.defineSlot(input, msg => {
        app.locals.logger.info(
          `Node ${id.slice(0, 4)} received message: ${msg}`,
        );

        const outputNodes = ctx.getOutputNodes(runtimeNode.getSlot('output')!);

        outputNodes.forEach(node => node.emit('input', msg));
      });
      runtimeNode.defineSlot(output);
      ctx.addNode(runtimeNode);
    }
    for (const edge of body.edges) {
      const id = uuid();

      edge.data = {
        ...edge.data,
        id,
      };

      const from = ctx.getNode(idMap.get(edge.source)!)!;
      const to = ctx.getNode(idMap.get(edge.target)!)!;

      ctx.connect(
        id,
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
