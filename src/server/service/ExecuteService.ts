import { inject, singleton } from 'tsyringe';
import { GraphService } from './GraphService';
import { SSEService } from './SSEService';
import * as SSEvents from '@/shared/sse-events';

@singleton()
export class ExecuteService {
  constructor(
    @inject(GraphService) private graph?: GraphService,
    @inject(SSEService) private sse?: SSEService,
  ) {}
  async runGraph(graphId: string) {
    const data = await this.graph!.findDetailById(graphId);
    this.sse!.sendMessage(SSEvents.GraphRun(graphId), data);
  }
}
