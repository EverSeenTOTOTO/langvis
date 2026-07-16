/**
 * eval 入口。直接 bun 跑（不经 make）：
 *
 * 单模型 × 单任务
 *
 * bun tests/eval/cli.ts --tasks flight:book-cheapest --models localhost:qwen3.5-9b --trials 1
 *
 * 配置轴（单模型换 driver 变体，测 driver 而非模型）：
 * bun tests/eval/cli.ts --tasks flight:book-cheapest --models localhost:qwen3.5-9b --variants default,bare --trials 3
 *
 * 跑批
 *
 * 全 sweep（任务 × 模型 × 变体 × 试次）：
 * bun tests/eval/cli.ts
 *
 * 子集批（自选任务×模型×变体×试次）：
 * bun tests/eval/cli.ts --tasks flight:book-cheapest,flight:multi-constraint --models openrouter:z-ai/glm-5.2,302:qwen3.7-max --variants default,bare --trials 5
 *
 *  resume：已写入 results.jsonl 的 (task×model×variant×trial) 自动跳过；中断后重跑即续。
 */
import cac from 'cac';
import { ALL_TASKS, type AnyTask } from './tasks';
import { MODELS, TRIALS, VARIANTS, DEFAULT_VARIANT } from './configs';
import { runOnce, runMultiTurn } from './runner';
import { append, completedKeys, loadExisting, printReport } from './report';
import type { MultiTurnTask, RunOutcome } from './types';

const isMultiTurn = (t: AnyTask): t is MultiTurnTask =>
  Array.isArray((t as MultiTurnTask).turns);

interface Args {
  tasks?: string[];
  models?: string[];
  variants?: string[];
  trials: number;
  help: boolean;
}

function parseArgs(argv: string[]): {
  cli: ReturnType<typeof cac>;
  args: Args;
} {
  const cli = cac()
    .option('--tasks <ids>', 'comma-separated task ids (default: all)')
    .option('--models <ids>', 'comma-separated model ids (default: MODELS)')
    .option(
      '--variants <ids>',
      'comma-separated variant ids (default: VARIANTS)',
    )
    .option('--trials <n>', 'trials per (task×model×variant)', {
      default: TRIALS,
    });
  const { options } = cli.parse(['bun', 'eval', ...argv]);
  const split = (v: unknown): string[] | undefined =>
    typeof v === 'string' ? v.split(',').filter(Boolean) : undefined;
  return {
    cli,
    args: {
      tasks: split(options.tasks),
      models: split(options.models),
      variants: split(options.variants),
      trials: Number(options.trials),
      help: Boolean(options.help),
    },
  };
}

async function main(): Promise<void> {
  const { cli, args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    cli.outputHelp();
    return;
  }
  const {
    tasks: taskFilter,
    models: modelFilter,
    variants: variantFilter,
    trials,
  } = args;
  const tasks = ALL_TASKS.filter(t => !taskFilter || taskFilter.includes(t.id));
  const models = modelFilter ?? [...MODELS];
  const variants = variantFilter ?? VARIANTS.map(v => v.id);
  if (!tasks.length) throw new Error('no tasks selected');

  const existing = await loadExisting();
  const done = completedKeys(existing);
  const fresh: RunOutcome[] = [];

  for (const t of tasks) {
    for (const m of models) {
      for (const v of variants) {
        for (let i = 0; i < trials; i++) {
          const trial = i + 1;
          const key = `${t.id}|${m}|${v}|${trial}`;
          if (done.has(key)) {
            console.log(`skip ${key} (done)`);
            continue;
          }
          console.log(`run ${key}`);
          const outcome = isMultiTurn(t)
            ? await runMultiTurn(t, m, trial, v)
            : await runOnce(t, m, trial, v);
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
  }

  const inScope = (o: RunOutcome) =>
    tasks.some(t => t.id === o.task) &&
    models.includes(o.model) &&
    variants.includes(o.variant ?? DEFAULT_VARIANT);
  const scoped = [...existing.filter(inScope), ...fresh];
  if (scoped.length) await printReport(scoped);
  else console.log('no outcomes to report');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
