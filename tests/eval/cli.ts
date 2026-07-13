/**
 * eval 入口。直接 bun 跑（不经 make）：
 *
 * 单模型 × 单任务
 *
 * bun tests/eval/cli.ts --tasks flight:book-cheapest --models localhost:qwen3.5-9b --trials 1
 *
 * 单任务、所有默认模型各 10 试：
 * bun tests/eval/cli.ts --tasks flight:book-cheapest
 *
 * 跑批
 *
 * 全 sweep（4 任务 × 3 模型 × 10 试 = 120 run）：
 * bun tests/eval/cli.ts
 *
 * 子集批（自选任务×模型×试次）：
 * bun tests/eval/cli.ts --tasks flight:book-cheapest,flight:multi-constraint --models openrouter:z-ai/glm-5.2,302:qwen3.7-max --trials 5
 *
 *  resume：已写入 results.jsonl 的 (task×model×trial) 自动跳过；中断后重跑即续。
 */
import { ALL_TASKS, type AnyTask } from './tasks';
import { MODELS, TRIALS } from './configs';
import { runOnce, runMultiTurn } from './runner';
import { append, completedKeys, loadExisting, printReport } from './report';
import type { MultiTurnTask, RunOutcome } from './types';

const isMultiTurn = (t: AnyTask): t is MultiTurnTask =>
  Array.isArray((t as MultiTurnTask).turns);

interface Args {
  tasks?: string[];
  models?: string[];
  trials: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const trialsRaw = get('--trials');
  return {
    tasks: get('--tasks')?.split(',').filter(Boolean),
    models: get('--models')?.split(',').filter(Boolean),
    trials: trialsRaw ? Number(trialsRaw) : TRIALS,
  };
}

async function main(): Promise<void> {
  const {
    tasks: taskFilter,
    models: modelFilter,
    trials,
  } = parseArgs(process.argv.slice(2));
  const tasks = ALL_TASKS.filter(t => !taskFilter || taskFilter.includes(t.id));
  const models = modelFilter ?? [...MODELS];
  if (!tasks.length) throw new Error('no tasks selected');

  const existing = await loadExisting();
  const done = completedKeys(existing);
  const fresh: RunOutcome[] = [];

  for (const t of tasks) {
    for (const m of models) {
      for (let i = 0; i < trials; i++) {
        const trial = i + 1;
        const key = `${t.id}|${m}|${trial}`;
        if (done.has(key)) {
          console.log(`skip ${key} (done)`);
          continue;
        }
        console.log(`run ${key}`);
        const outcome = isMultiTurn(t)
          ? await runMultiTurn(t, m, trial)
          : await runOnce(t, m, trial);
        await append(outcome);
        fresh.push(outcome);
        console.log(
          `  -> ${outcome.status} | pass=${outcome.correctness.pass} | iter=${outcome.efficiency.iterations} | ${outcome.correctness.reason}`,
        );
        if (outcome.workDir) {
          console.log(`     workDir ${outcome.workDir}`);
        }
      }
    }
  }

  const inScope = (o: RunOutcome) =>
    tasks.some(t => t.id === o.task) && models.includes(o.model);
  const scoped = [...existing.filter(inScope), ...fresh];
  if (scoped.length) await printReport(scoped);
  else console.log('no outcomes to report');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
