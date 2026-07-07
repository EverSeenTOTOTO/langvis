import { Query } from '@/server/libs/ddd';

/** 取任意 run（含子 agent run）的投影视图——live 优先、repo 回落。 */
export class GetRunViewQuery extends Query {
  constructor(readonly runId: string) {
    super();
  }
}
