/**
 * 结果落盘（JSONL）+ resume-by-counting + Wilson 95% CI + 多维聚合打表。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DesignMetrics, RunOutcome } from './types';

const RESULTS = path.resolve('tests/eval/results.jsonl');
const REPORT = path.resolve('tests/eval/report.md');

export async function loadExisting(): Promise<RunOutcome[]> {
  try {
    const txt = await fs.readFile(RESULTS, 'utf8');
    return txt
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as RunOutcome);
  } catch {
    return [];
  }
}

export async function append(outcome: RunOutcome): Promise<void> {
  await fs.appendFile(RESULTS, JSON.stringify(outcome) + '\n');
}

/** 已完成 (task×model×trial) 三元组集合——resume 据此跳过。 */
export function completedKeys(existing: readonly RunOutcome[]): Set<string> {
  return new Set(existing.map(o => `${o.task}|${o.model}|${o.trial}`));
}

/** Wilson score 95% CI（二项 pass-rate）。 */
export function wilson(
  passes: number,
  total: number,
): { lo: number; hi: number } {
  if (total === 0) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = passes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
    denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

type CellAgg = {
  passes: number;
  total: number;
  eff: {
    iterations: number;
    toolCalls: number;
    peakContext: number;
    cumulativeCostProxy: number;
    durationMs: number;
  };
  design: DesignMetrics;
  safetyPasses: number;
  safetyTotal: number;
};

function emptyCell(): CellAgg {
  return {
    passes: 0,
    total: 0,
    eff: {
      iterations: 0,
      toolCalls: 0,
      peakContext: 0,
      cumulativeCostProxy: 0,
      durationMs: 0,
    },
    design: {
      toolErrors: 0,
      errorTools: [],
      compactionTriggers: 0,
      budgetHit: false,
      stuckHit: false,
      iterationCapHit: false,
      redundantCalls: 0,
    },
    safetyPasses: 0,
    safetyTotal: 0,
  };
}

/** 聚合键：model（跨任务均值）或 `task|model`（单格）。 */
function aggregate(
  outcomes: readonly RunOutcome[],
  keyOf: (o: RunOutcome) => string,
): Map<string, CellAgg> {
  const cells = new Map<string, CellAgg>();
  for (const o of outcomes) {
    const k = keyOf(o);
    const c = cells.get(k) ?? emptyCell();
    c.total++;
    if (o.correctness.pass) c.passes++;
    c.eff.iterations += o.efficiency.iterations;
    c.eff.toolCalls += o.efficiency.toolCalls;
    c.eff.peakContext = Math.max(c.eff.peakContext, o.efficiency.peakContext);
    c.eff.cumulativeCostProxy += o.efficiency.cumulativeCostProxy;
    c.eff.durationMs += o.efficiency.durationMs;
    c.design.toolErrors += o.design.toolErrors;
    c.design.compactionTriggers += o.design.compactionTriggers;
    if (o.design.budgetHit) c.design.budgetHit = true;
    if (o.design.stuckHit) c.design.stuckHit = true;
    if (o.design.iterationCapHit) c.design.iterationCapHit = true;
    c.design.redundantCalls = Math.max(
      c.design.redundantCalls,
      o.design.redundantCalls,
    );
    if (o.safety) {
      c.safetyTotal++;
      if (o.safety.pass) c.safetyPasses++;
    }
    cells.set(k, c);
  }
  return cells;
}

const avg = (n: number, total: number) => (total ? n / total : 0);

function fmtRate(passes: number, total: number): string {
  if (!total) return '-';
  const { lo, hi } = wilson(passes, total);
  return `${pct(passes / total)} [${pct(lo)}-${pct(hi)}]`;
}

function mkTable(rows: readonly Record<string, string | number>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  const head = `| ${cols.join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows
    .map(r => `| ${cols.map(c => r[c]).join(' | ')} |`)
    .join('\n');
  return `${head}\n${sep}\n${body}`;
}

/** 打印 console 表 + 落 markdown 报告。 */
export async function printReport(
  outcomes: readonly RunOutcome[],
): Promise<void> {
  const tasks = [...new Set(outcomes.map(o => o.task))].sort();
  const models = [...new Set(outcomes.map(o => o.model))].sort();

  const byCell = aggregate(outcomes, o => `${o.task}|${o.model}`);
  const byModel = aggregate(outcomes, o => o.model);

  const correctnessRows = models.map(m => {
    const row: Record<string, string | number> = { model: m };
    for (const t of tasks) {
      const c = byCell.get(`${t}|${m}`);
      row[t] = c ? fmtRate(c.passes, c.total) : '-';
    }
    const cm = byModel.get(m)!;
    row['overall'] = fmtRate(cm.passes, cm.total);
    return row;
  });

  const designRows = models.map(m => {
    const c = byModel.get(m)!;
    const row: Record<string, string | number> = { model: m };
    row['avg_iter'] = avg(c.eff.iterations, c.total).toFixed(1);
    row['avg_calls'] = avg(c.eff.toolCalls, c.total).toFixed(1);
    row['peak_ctx'] = c.eff.peakContext;
    row['avg_cost'] = Math.round(avg(c.eff.cumulativeCostProxy, c.total));
    row['tool_err'] = avg(c.design.toolErrors, c.total).toFixed(1);
    row['compact'] = avg(c.design.compactionTriggers, c.total).toFixed(1);
    row['budget_hit'] = c.design.budgetHit ? 'Y' : '-';
    row['stuck_hit'] = c.design.stuckHit ? 'Y' : '-';
    row['iter_cap'] = c.design.iterationCapHit ? 'Y' : '-';
    row['max_redundant'] = c.design.redundantCalls;
    row['safety'] = c.safetyTotal
      ? fmtRate(c.safetyPasses, c.safetyTotal)
      : '-';
    return row;
  });

  console.log('\n=== Correctness (pass% [95% CI]) ===');
  console.table(correctnessRows);
  console.log('\n=== Design exposure / efficiency ===');
  console.table(designRows);

  const md = [
    '# Eval report',
    '## Correctness (pass% [95% CI])\n',
    mkTable(correctnessRows),
    '\n## Design exposure / efficiency\n',
    mkTable(designRows),
  ].join('\n');
  await fs.writeFile(REPORT, md, 'utf8');
  console.log(`\nreport -> ${REPORT}`);
}
