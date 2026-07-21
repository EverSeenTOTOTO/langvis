import { copyFile } from 'fs/promises';
import path from 'path';
import type { EnrichedEvent } from '@/shared/types/events';
import { ToolIds } from '@/shared/constants';
import type { Task } from '../../../types';
import { FsBackend, fsDocToolSet } from '../sandbox';

/** 本机路径：eval 本地直跑（bun tests/eval/cli.ts），PDF 存于用户 ~/Documents。 */
const HOST_PDF =
  '/home/everseen/Documents/financial-report/geely/2024/c00175_Annual-Report_20250428-1.pdf';
const WORKDIR_PDF = 'geely-2024-annual-report.pdf';

/** 取最后一次 response_user 的 message（= final answer），比 text_chunk 更权威。 */
function finalReply(events: readonly EnrichedEvent[]): string {
  const msgs = events
    .filter(e => e.type === 'tool_call')
    .map(e => e as Extract<EnrichedEvent, { type: 'tool_call' }>)
    .filter(e => e.toolName === ToolIds.RESPONSE_USER)
    .map(e => String((e.toolArgs as { message?: unknown }).message ?? ''));
  return msgs[msgs.length - 1] ?? '';
}

/** 从答复里按标签抽数值。两遍：先要"标签…: <数值>"模板形（强约束），再退到含标签行首个数值。
 *  模板形优先 → 即便答复里有"归属母公司净利润 166.3"散文干扰，只要模板行在，仍取模板行的 168.0。 */
function extractMetric(reply: string, label: string): number | null {
  const lines = reply.split('\n');
  for (const line of lines) {
    if (!line.includes(label)) continue;
    const m = line.match(
      new RegExp(`${label}[^\\n]*?[:：]\\s*(-?\\d+(?:\\.\\d+)?)`),
    );
    if (m) return Number(m[1]);
  }
  for (const line of lines) {
    if (!line.includes(label)) continue;
    const m = line.match(/(-?\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * 判分全静态、无 LLM：completed + pdf_extract 硬门槛（反幻觉：非凭空造数）+ 四项数值落紧容差。
 * 模板锁死单位（亿元/%），故容差可紧。营收真值 240,194,270 千元 = 2401.9 亿（报告五年概要页
 * 的"240.2"是十億元口径=2402 亿）；把 240.2 当亿填、或误报 24019，均越界判 fail。
 * 净利润下界 167 > 归属母公司溢利 166.3 亿，故排除常见误取"歸屬本公司股權持有人溢利"。
 */
const task: Task<FsBackend> = {
  id: 'fs:geely-2024-metrics',
  domain: 'fs',
  difficulty: 'medium',
  userGoal:
    `工作目录下有 ${WORKDIR_PDF}（吉利汽车控股有限公司 2024 年度报告，中文/繁体）。\n` +
    '请基于该年报的"綜合收益表"（Consolidated Income Statement，列有收益/銷售成本/毛利/本年度溢利等行项目，' +
    '同时给出 2024 与 2023 两列对照）计算以下指标：\n' +
    '1. 2024 年营业收入（"收益"行），以人民币亿元为单位，保留 1 位小数；\n' +
    '2. 营业收入同比增速 = (2024 收益 − 2023 收益) ÷ 2023 收益 × 100%，百分比，保留 1 位小数；\n' +
    '3. 2024 年毛利率 = "毛利"行 ÷ "收益"行 × 100%（其中毛利 = 收益 − 銷售成本，取綜合收益表中的"毛利"行），百分比，保留 1 位小数；\n' +
    '4. 2024 年净利润 = "本年度溢利"行（注意是利润表的本年度溢利，不是"歸屬本公司股權持有人溢利"），以人民币亿元为单位，保留 1 位小数。\n' +
    '完成后用 response_user 回复，并**严格按以下模板**（每项一行，只填数值，单位已给定勿改，' +
    '可在数值后附简短计算式）。模板形如下，照此四行给出（不要漏行、不要改单位）：\n' +
    '营业收入(亿元): <数值>\n' +
    '营收同比增速(%): <数值>\n' +
    '毛利率(%): <数值>\n' +
    '净利润(亿元): <数值>',
  budget: { maxIterations: 30 },
  setup: () => ({
    sandbox: new FsBackend(),
    tools: [],
    toolSet: fsDocToolSet(),
  }),
  seedWorkDir: async workDir => {
    await copyFile(HOST_PDF, path.join(workDir, WORKDIR_PDF));
  },
  success: (_sandbox, run, events) => {
    if (run.currentStatus !== 'completed') {
      return {
        pass: false,
        reason: `run not completed (status=${run.currentStatus})`,
      };
    }
    const calledPdf = events.some(
      e =>
        e.type === 'tool_call' &&
        (e as Extract<EnrichedEvent, { type: 'tool_call' }>).toolName ===
          'pdf_extract',
    );
    if (!calledPdf) {
      return { pass: false, reason: '未调用 pdf_extract 读取 PDF' };
    }
    const reply = finalReply(events);
    if (!reply) return { pass: false, reason: '无 response_user 终答' };

    const checks = [
      {
        name: '营业收入(亿元)',
        v: extractMetric(reply, '营业收入'),
        lo: 2390,
        hi: 2410,
        truth: '2401.9',
      },
      {
        name: '营收同比增速(%)',
        v: extractMetric(reply, '营收同比增速'),
        lo: 33,
        hi: 35,
        truth: '34.0',
      },
      {
        name: '毛利率(%)',
        v: extractMetric(reply, '毛利率'),
        lo: 15.5,
        hi: 16.3,
        truth: '15.9',
      },
      {
        name: '净利润(亿元)',
        v: extractMetric(reply, '净利润'),
        lo: 167,
        hi: 169,
        truth: '168.0',
      },
    ];
    const inBand = (v: number | null, lo: number, hi: number) =>
      v !== null && v >= lo && v <= hi;
    const failed = checks.filter(c => !inBand(c.v, c.lo, c.hi));
    if (failed.length === 0) {
      return {
        pass: true,
        reason: `四项数值均在容差内: ${checks.map(c => `${c.name}=${c.v}`).join(', ')}`,
      };
    }
    const detail = checks
      .map(
        c => `${c.name}=${c.v ?? '缺失'}(容差[${c.lo},${c.hi}],真值${c.truth})`,
      )
      .join('; ');
    return {
      pass: false,
      reason: `数值越界/缺失: ${failed.map(f => f.name).join(',')} | ${detail}`,
    };
  },
};

export default task;
