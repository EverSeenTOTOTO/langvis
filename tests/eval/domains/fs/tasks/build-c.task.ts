import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { EnrichedEvent } from '@/shared/types/events';
import type { Task } from '../../../types';
import { FsBackend, fsToolSet } from '../sandbox';

/** 末条 assistant 文案（text_chunk 拼接）——agent 经 response_user 交付的答案。 */
function assistantText(events: readonly EnrichedEvent[]): string {
  return events
    .filter(e => e.type === 'text_chunk')
    .map(e => (e as Extract<EnrichedEvent, { type: 'text_chunk' }>).content)
    .join('');
}

const task: Task<FsBackend> = {
  id: 'fs:build-c',
  domain: 'fs',
  difficulty: 'easy',
  userGoal:
    '在当前工作目录写一个 C 程序，运行时打印一行 "Hello, langvis!"。然后用 gcc 把它编译成可执行文件，再运行，把程序的实际输出告诉我。',
  setup: () => ({
    sandbox: new FsBackend(),
    tools: [],
    toolSet: fsToolSet(),
  }),
  budget: { maxIterations: 20 },
  success: (b, run, events) => {
    if (!b.workDir) {
      return { pass: false, reason: 'workDir 未注入到 sandbox' };
    }
    const cPath = path.join(b.workDir, 'hello.c');
    if (!existsSync(cPath)) {
      return { pass: false, reason: 'hello.c 未创建' };
    }
    const cSrc = readFileSync(cPath, 'utf-8');
    if (!/int\s+main\s*\(/.test(cSrc)) {
      return { pass: false, reason: 'hello.c 无 main 函数' };
    }
    const binPath = path.join(b.workDir, 'hello');
    if (!existsSync(binPath)) {
      return {
        pass: false,
        reason: '可执行文件 hello 未生成（编译失败或未编译）',
      };
    }
    // ELF magic：确认是真二进制而非源码同名文件。
    const head = readFileSync(binPath);
    const isElf =
      head[0] === 0x7f &&
      head[1] === 0x45 &&
      head[2] === 0x4c &&
      head[3] === 0x46;
    if (!isElf) {
      return { pass: false, reason: 'hello 不是 ELF 可执行文件' };
    }
    const text = assistantText(events);
    if (!text.includes('Hello, langvis!')) {
      return {
        pass: false,
        reason: `agent 未报告程序输出（末条文案不含 "Hello, langvis!"）: ${text.slice(0, 120)}`,
      };
    }
    if (run.currentStatus !== 'completed') {
      return {
        pass: false,
        reason: `run 未正常完成 (status=${run.currentStatus})`,
      };
    }
    return { pass: true, reason: '写文件→编译→运行→报告输出全链路打通' };
  },
};

export default task;
