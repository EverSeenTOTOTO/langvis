import { Query } from '@/server/libs/ddd';

/** 取任意 run（含子 agent run）的投影视图——live 优先、repo 回落。 */
export class GetRunViewQuery extends Query {
  constructor(readonly runId: string) {
    super();
  }
}

/** 列出某父 run 派生的子 agent run（childRunId 从父 tool_progress 事件解析，无 schema 变更）。 */
export class GetChildRunsQuery extends Query {
  constructor(readonly parentRunId: string) {
    super();
  }
}
