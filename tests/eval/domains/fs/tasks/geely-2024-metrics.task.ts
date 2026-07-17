import { copyFile } from 'fs/promises';
import path from 'path';
import type { EnrichedEvent } from '@/shared/types/events';
import type { Task } from '../../../types';
import { FsBackend, fsDocToolSet } from '../sandbox';

/** 本机路径：eval 本地直跑（bun tests/eval/cli.ts），PDF 存于用户 ~/Documents。 */
const HOST_PDF =
  '/home/everseen/Documents/financial-report/geely/2024/c00175_Annual-Report_20250428-1.pdf';
const WORKDIR_PDF = 'geely-2024-annual-report.pdf';

/** 末条 assistant 文案（text_chunk 拼接）——agent 经 response_user 交付的答案。 */
function assistantText(events: readonly EnrichedEvent[]): string {
  return events
    .filter(e => e.type === 'text_chunk')
    .map(e => (e as Extract<EnrichedEvent, { type: 'text_chunk' }>).content)
    .join('');
}

/** 从文本里提取所有数字（支持千分位逗号与小数），返回去逗号后的数值数组。 */
function allNumbers(text: string): number[] {
  const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  const out: number[] = [];
  for (let m; (m = re.exec(text)) !== null; ) {
    out.push(Number(m[0].replace(/,/g, '')));
  }
  return out;
}

/**
 * 关键词锚定的容差判分：在任一 anchor 词附近 ±window 字符内出现落在任一容差带的数即过。
 * 锚定避免页码/无关数字误命中（如"第 127 页"被当成营收）。
 */
function metricPass(
  text: string,
  anchors: string[],
  bands: Array<[number, number]>,
  window = 200,
): boolean {
  for (const anchor of anchors) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(anchor, from);
      if (idx === -1) break;
      const seg = text.slice(
        Math.max(0, idx - window),
        idx + anchor.length + window,
      );
      for (const n of allNumbers(seg)) {
        if (bands.some(([lo, hi]) => n >= lo && n <= hi)) return true;
      }
      from = idx + anchor.length;
    }
  }
  return false;
}

const task: Task<FsBackend> = {
  id: 'fs:geely-2024-metrics',
  domain: 'fs',
  difficulty: 'medium',
  userGoal:
    `工作目录下有 ${WORKDIR_PDF}（吉利汽车控股有限公司 2024 年度报告，中文/繁体）。\n` +
    '请基于该年报的"綜合收益表"（Consolidated Income Statement，列有收益/銷售成本/毛利/本年度溢利等行项目，' +
    '同时给出 2024 与 2023 两列对照）计算以下指标，并用 response_user 把结果（含所用数值与计算式）告诉我：\n' +
    '1. 2024 年营业收入（"收益"行），以人民币亿元为单位，保留 1 位小数；\n' +
    '2. 营业收入同比增速 = (2024 收益 − 2023 收益) ÷ 2023 收益 × 100%，百分比，保留 1 位小数；\n' +
    '3. 2024 年毛利率 = "毛利"行 ÷ "收益"行 × 100%（其中毛利 = 收益 − 銷售成本，取綜合收益表中的"毛利"行），百分比，保留 1 位小数；\n' +
    '4. 2024 年净利润 = "本年度溢利"行（注意是利润表的本年度溢利，不是"歸屬本公司股權持有人溢利"），以人民币亿元为单位，保留 1 位小数。\n',
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
    const text = assistantText(events);
    if (!text.trim()) {
      return { pass: false, reason: 'response_user 答案为空' };
    }

    // Ground truth（综合收益表，单位人民币千元）：
    //   营收 2024 = 240,194,270（≈240.2 亿）；2023 = 179,203,592 → 同比 +34.05%
    //   毛利 2024 = 38,200,849 → 毛利率 15.90%
    //   净利润 2024 = 16,799,095（≈168.0 亿）
    // 每项给多个等价容差带：亿元 / 百分比 / 原始千元 / 百万元，兼容 agent 选用的单位。
    const checks: Array<{ name: string; ok: boolean }> = [
      {
        name: '营业收入',
        ok: metricPass(
          text,
          ['营业收入', '收益', '收入'],
          [
            [2390, 2410], // 亿元（240,194,270 千元 ÷ 1e5 ≈ 2401.9 亿）
            [240_000, 241_000], // 百万元（240,194）
            [240_000_000, 240_400_000], // 千元（240,194,270）
          ],
        ),
      },
      {
        name: '营收同比增速',
        ok: metricPass(text, ['同比', '增速', '增长'], [[32, 36]]),
      },
      {
        name: '毛利率',
        ok: metricPass(text, ['毛利率', '毛利'], [[15.4, 16.4]]),
      },
      {
        name: '净利润',
        ok: metricPass(
          text,
          ['净利润', '净利', '溢利', '本年度溢利'],
          [
            [164, 172], // 亿元（≈168）
            [16_790_000, 16_810_000], // 千元（16,799,095）
            [16_790, 16_810], // 百万元（16,799）
          ],
        ),
      },
    ];
    const failed = checks.filter(c => !c.ok).map(c => c.name);
    if (failed.length) {
      return {
        pass: false,
        reason: `指标未通过(容差内未找到数值): ${failed.join('、')} | 答案片段: ${text.slice(0, 160)}`,
      };
    }
    return { pass: true, reason: '四项指标均落在容差带内' };
  },
};

export default task;
