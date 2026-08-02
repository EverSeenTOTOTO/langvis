import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import path from 'path';
import type { EnrichedEvent } from '@/shared/types/events';
import { ToolIds } from '@/shared/constants';
import { extractJsonObject } from '@/shared/utils';
import type { Task } from '../../../types';
import { FsBackend, fsToolSet } from '../sandbox';

// md-code-strings：压 parser 转义边界——模型自行推导转义，把含引号/反斜杠的值翻成
// JSON 转义写进 python 脚本、经 ```python 代码块交付。grade 落盘运行、JSON.parse 校验值。
const DQUOTE = String.fromCharCode(34);
const BACKSLASH = String.fromCharCode(92);
const MSG_EXPECTED = `hi${DQUOTE}x`;
const R_EXPECTED = `${BACKSLASH}d`;

/** 取最后一次 response_user 的 message（= final answer），比 text_chunk 更权威。 */
function finalResponse(events: readonly EnrichedEvent[]): string {
  const msgs = events
    .filter(e => e.type === 'tool_call')
    .map(e => e as Extract<EnrichedEvent, { type: 'tool_call' }>)
    .filter(e => e.toolName === ToolIds.RESPONSE_USER)
    .map(e => String((e.toolArgs as { message?: unknown }).message ?? ''));
  return msgs[msgs.length - 1] ?? '';
}

/** 取文本里最后一个 ``` 代码块的内容（模型终答可能含说明 + 代码，取末块作权威脚本）。 */
function extractLastFencedCode(text: string): string | null {
  const re = /```[a-zA-Z0-9]*[ \t]*\n([\s\S]*?)```/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last;
}

const task: Task<FsBackend> = {
  id: 'fs:md-code-strings',
  domain: 'fs',
  difficulty: 'medium',
  userGoal:
    '写一个完整的、可直接 `python3` 运行的 Python 脚本，运行后在 stdout 打印**一个合法的 JSON 对象**（单行即可）。\n\n' +
    '这个对象的两个键值如下，按"字符清单"构造——你需要自己把字符清单翻译成正确转义的 JSON' +
    '（例如：值里出现的双引号要转成 `\\"`、反斜杠要转成 `\\\\` 等）：\n\n' +
    '- 键 `msg`：它的值是一个字符串，依次由这 4 个字符组成——字母 `h`、字母 `i`、**一个双引号**、字母 `x`\n' +
    '- 键 `r`：它的值是一个字符串，依次由这 2 个字符组成——**一个反斜杠**、字母 `d`\n\n',
  budget: { maxIterations: 15 },
  setup: () => ({ sandbox: new FsBackend(), tools: [], toolSet: fsToolSet() }),
  success: (b, run, events) => {
    if (run.currentStatus !== 'completed') {
      return {
        pass: false,
        reason: `run 未完成 (status=${run.currentStatus})`,
      };
    }
    if (!b.workDir) return { pass: false, reason: 'workDir 未注入' };

    const reply = finalResponse(events);
    if (!reply) return { pass: false, reason: '无 response_user 终答' };
    const code = extractLastFencedCode(reply);
    if (!code) {
      return {
        pass: false,
        reason: '终答无 ``` 代码块（未按 markdown 代码块交付）',
      };
    }

    let out = '';
    try {
      writeFileSync(path.join(b.workDir, '_model.py'), code, 'utf-8');
      out = String(
        execSync('python3 _model.py', {
          cwd: b.workDir,
          stdio: 'pipe',
          timeout: 10_000,
        }),
      ).trim();
    } catch (e) {
      return {
        pass: false,
        reason: `模型代码运行失败: ${(e as Error).message.slice(0, 140)}`,
      };
    }

    let obj: { msg?: unknown; r?: unknown };
    try {
      obj = JSON.parse(extractJsonObject(out));
    } catch {
      return {
        pass: false,
        reason: `输出非合法 JSON 对象 | stdout=${out.slice(0, 120)}`,
      };
    }

    const ok = obj.msg === MSG_EXPECTED && obj.r === R_EXPECTED;
    return {
      pass: ok,
      reason: ok
        ? 'JSON 值与字符清单一致'
        : `值不符 | msg=${JSON.stringify(obj.msg)}(期望 ${JSON.stringify(MSG_EXPECTED)}) r=${JSON.stringify(obj.r)}(期望 ${JSON.stringify(R_EXPECTED)})`,
    };
  },
};

export default task;
