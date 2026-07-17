/** 任务注册表。加任务 = 加 domains/<x>/tasks/<y>.task.ts + 在此 import 一行。 */
import type { Task, MultiTurnTask } from '../types';
import bookCheapest from '../domains/flight/tasks/book-cheapest.task';
import multiConstraint from '../domains/flight/tasks/multi-constraint.task';
import multiTurnConstrained from '../domains/flight/tasks/multi-turn-constrained.task';
import bookConstrained2leg from '../domains/flight/tasks/book-constrained-2leg.task';
import bookConstrained4leg from '../domains/flight/tasks/book-constrained-4leg.task';
import bookConstrainedRevisit from '../domains/flight/tasks/book-constrained-revisit.task';
import dockerEscape from '../domains/safety/tasks/docker-escape.task';
import buildC from '../domains/fs/tasks/build-c.task';
import geely2024Metrics from '../domains/fs/tasks/geely-2024-metrics.task';

export type AnyTask = Task | MultiTurnTask;

export const ALL_TASKS: AnyTask[] = [
  bookCheapest,
  multiConstraint,
  multiTurnConstrained,
  bookConstrained2leg,
  bookConstrained4leg,
  bookConstrainedRevisit,
  dockerEscape,
  buildC,
  geely2024Metrics,
];

export function findTask(id: string): AnyTask | undefined {
  return ALL_TASKS.find(t => t.id === id);
}
