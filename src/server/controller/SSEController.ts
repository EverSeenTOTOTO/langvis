import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { SSEService } from '../service/SSEService';

@singleton()
@controller('/api/sse')
export class SSEController {
  constructor(@inject(SSEService) private sseService?: SSEService) {}

  @api('')
  onConnect(req: Request, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    this.sseService!.setSendMessage((event: string, data: any) => {
      res.write(`data: ${JSON.stringify({ event, data })}\n\n`);
    });

    req.on('error', e => {
      console.error(`SSE connection error: `, e);
      res.end();
    });
    req.on('close', () => {
      res.end();
    });
  }
}
