/**
 * 结果落盘（JSONL）+ resume-by-counting + Wilson 95% CI + 多维聚合打表。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DesignMetrics, RunOutcome } from './types';
import { DEFAULT_VARIANT } from './configs';

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

/**
 * 已完成 (task×model×variant×trial) 四元组集合——resume 据此跳过。
 * 旧 jsonl 无 variant 字段，回填 DEFAULT_VARIANT（compact-only）。
 */
export function completedKeys(existing: readonly RunOutcome[]): Set<string> {
  return new Set(
    existing.map(
      o => `${o.task}|${o.model}|${o.variant ?? DEFAULT_VARIANT}|${o.trial}`,
    ),
  );
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

/**
 * 非确定性两轴（指南 §5）。二者都只是单次成功率 p 的函数——p 已由上方 Wilson 估出，
 * 此处用点估计 p̂=passes/total 推算；区间仍读 correctness 表的 p̂ CI，不重复传播（免增列宽）。
 *
 * - pass@k = 1-(1-p)^k  ：k 次里至少 1 次成功（有人把关、峰值性能）。
 * - pass^k = p^k        ：k 次全成功（无人把关、稳定性）。
 *
 * p=0.75 时 pass@10≈99.99% 而 pass^10≈5.6%——同一 agent 两种叙事，差距触目惊心。
 */
const passAtK = (p: number, k: number): number => 1 - (1 - p) ** k;
const passPowK = (p: number, k: number): number => p ** k;

/** 报告用的 k 档：3（快速验证量级）与 10（= TRIALS 默认，正式评估量级）。 */
const K_VALUES = [3, 10];

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
  /** turn-end CompactTransform 触发数累计（会话级压缩读数）。 */
  historyCompactions: number;
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
    historyCompactions: 0,
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
    c.historyCompactions += o.historyCompactions ?? 0;
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

/** pass 率（小数），无数据返回 NaN。 */
function passRate(cell: CellAgg | undefined): number {
  if (!cell || !cell.total) return NaN;
  return cell.passes / cell.total;
}

/**
 * headroom = 同 (model, task) 上最优 variant − baseline variant 的 pass 率差。
 * baseline = 'bare'（fold/offload 全关）；缺该 variant 数据则该格 headroom 不可算。
 * >0 → driver 有贡献（baseline 过不了、调上来能过）；≈0 → 该场景不区分 driver（太易/太难）。
 */
const BASELINE_VARIANT = 'bare';

function headroomRows(
  outcomes: readonly RunOutcome[],
  tasks: readonly string[],
  models: readonly string[],
): Record<string, string | number>[] {
  const byCellVar = aggregate(
    outcomes,
    o => `${o.task}|${o.model}|${o.variant ?? DEFAULT_VARIANT}`,
  );
  return models.map(m => {
    const row: Record<string, string | number> = { model: m };
    for (const t of tasks) {
      const baseline = passRate(byCellVar.get(`${t}|${m}|${BASELINE_VARIANT}`));
      let best = NaN;
      for (const o of outcomes) {
        if (o.task !== t || o.model !== m) continue;
        const v = o.variant ?? DEFAULT_VARIANT;
        if (v === BASELINE_VARIANT) continue;
        const r = passRate(byCellVar.get(`${t}|${m}|${v}`));
        if (Number.isNaN(r)) continue;
        if (Number.isNaN(best) || r > best) best = r;
      }
      if (Number.isNaN(baseline)) {
        row[t] = '-';
      } else if (Number.isNaN(best)) {
        row[t] = `${pct(baseline)} (无对比变体)`;
      } else {
        row[t] =
          `${pct(best - baseline)} (基线 ${pct(baseline)} → 最优 ${pct(best)})`;
      }
    }
    return row;
  });
}

/** task id 形如 `domain:task-name`——取冒号前缀作 domain，用于按域分表。 */
function domainOf(taskId: string): string {
  return taskId.includes(':') ? taskId.split(':')[0]! : '(other)';
}

/** 按 domain 分组 tasks（保持 domain 字典序、域内 task 序）。 */
function groupTasksByDomain(tasks: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const t of tasks) {
    const d = domainOf(t);
    const arr = groups.get(d) ?? [];
    arr.push(t);
    groups.set(d, arr);
  }
  return groups;
}

/** 打印 console 表 + 落 markdown 报告。 */
export async function printReport(
  outcomes: readonly RunOutcome[],
): Promise<void> {
  const tasks = [...new Set(outcomes.map(o => o.task))].sort();
  const models = [...new Set(outcomes.map(o => o.model))].sort();
  const variants = [
    ...new Set(outcomes.map(o => o.variant ?? DEFAULT_VARIANT)),
  ].sort();

  const byCellVar = aggregate(
    outcomes,
    o => `${o.task}|${o.model}|${o.variant ?? DEFAULT_VARIANT}`,
  );
  const byModelVar = aggregate(
    outcomes,
    o => `${o.model}|${o.variant ?? DEFAULT_VARIANT}`,
  );
  // per-domain×model×variant 聚合：correctness 表的 overall 列按域算，不混其他域。
  const byDomainModelVar = aggregate(
    outcomes,
    o => `${domainOf(o.task)}|${o.model}|${o.variant ?? DEFAULT_VARIANT}`,
  );

  // 每个 variant 一组切片表（correctness 按 domain 分表 + design），避免横向溢出与跨 variant 混淆。
  const domains = groupTasksByDomain(tasks);
  const sections: string[] = ['# Eval report'];
  for (const v of variants) {
    // correctness：每个 domain 一张表（列 = 该域的 tasks），overall 列 = 该域合并率。
    for (const [d, dTasks] of domains) {
      const correctnessRows = models.map(m => {
        const row: Record<string, string | number> = { model: m };
        for (const t of dTasks) {
          const c = byCellVar.get(`${t}|${m}|${v}`);
          row[t] = c ? fmtRate(c.passes, c.total) : '-';
        }
        const cm = byDomainModelVar.get(`${d}|${m}|${v}`);
        row['overall'] = cm ? fmtRate(cm.passes, cm.total) : '-';
        return row;
      });
      console.log(
        `\n=== [variant: ${v}] [${d}] Correctness (pass% [95% CI]) ===`,
      );
      console.table(correctnessRows);
      sections.push(
        `## [variant: ${v}] [${d}] Correctness (pass% [95% CI])\n`,
        mkTable(correctnessRows),
      );
    }

    const designRows = models
      .map(m => {
        const c = byModelVar.get(`${m}|${v}`);
        if (!c) return null;
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
        row['hist_compact'] = avg(c.historyCompactions, c.total).toFixed(1);
        return row;
      })
      .filter((r): r is Record<string, string | number> => r !== null);

    if (designRows.length) {
      console.log(`\n=== [variant: ${v}] Design exposure / efficiency ===`);
      console.table(designRows);
      sections.push(
        `\n## [variant: ${v}] Design exposure / efficiency\n`,
        mkTable(designRows),
      );
    }

    // 非确定性剖面（指南 §5 pass@k / pass^k）。按 domain 分表，行=model，
    // 列=各 k 档的 pass@k（有人把关/峰值）与 pass^k（无人把关/稳定）。
    // pass@1=p̂ 已在 correctness 表 overall 列，不重复。仅点估计，p̂ 的 CI 读 correctness 表。
    for (const [d] of domains) {
      const detRows = models
        .map(m => {
          const c = byDomainModelVar.get(`${d}|${m}|${v}`);
          if (!c || !c.total) return null;
          const p = c.passes / c.total;
          const row: Record<string, string | number> = { model: m };
          for (const k of K_VALUES) {
            row[`pass@${k}`] = pct(passAtK(p, k));
            row[`pass^${k}`] = pct(passPowK(p, k));
          }
          return row;
        })
        .filter((r): r is Record<string, string | number> => r !== null);
      if (!detRows.length) continue;
      console.log(
        `\n=== [variant: ${v}] [${d}] Non-determinism (pass@k 有人把关 / pass^k 无人把关) ===`,
      );
      console.table(detRows);
      sections.push(
        `\n## [variant: ${v}] [${d}] Non-determinism (pass@k / pass^k)\n`,
        mkTable(detRows),
      );
    }
  }

  // headroom 表：仅多 variant 时才有意义；按 domain 分表（与 correctness 同理）。
  if (variants.length > 1) {
    for (const [d, dTasks] of domains) {
      const hRows = headroomRows(outcomes, dTasks, models);
      console.log(
        `\n=== [${d}] Driver headroom (最优 variant − baseline/bare) ===`,
      );
      console.table(hRows);
      sections.push(
        `\n## [${d}] Driver headroom (最优 variant − baseline/bare)\n`,
        mkTable(hRows),
      );
    }
  }

  const md = sections.join('\n');
  await fs.writeFile(REPORT, md, 'utf8');
  console.log(`\nreport -> ${REPORT}`);
}
