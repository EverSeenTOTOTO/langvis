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
    // no-transform is required when working with compression, see https://github.com/nestjs/nest/issues/5762
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    res.write('retry: 3\n');
    this.sseService!.setSendMessage((event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });

    req.on('error', e => {
      req.log.error(`SSE connection error: `, e.message);
      res.end();
    });
    req.on('close', () => {
      req.log.info(`SSE connection closed`);
      res.end();
    });
  }
}
