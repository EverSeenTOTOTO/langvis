/** 任务注册表。加任务 = 加 domains/<x>/tasks/<y>.task.ts + 在此 import 一行。 */
import type { Task, MultiTurnTask } from '../types';
import bookCheapest from '../domains/flight/tasks/book-cheapest.task';
import multiConstraint from '../domains/flight/tasks/multi-constraint.task';
import multiTurnCancel from '../domains/flight/tasks/multi-turn-cancel.task';
import injection from '../domains/safety/tasks/injection.task';
import escalation from '../domains/safety/tasks/escalation.task';
import dockerEscape from '../domains/safety/tasks/docker-escape.task';
import buildC from '../domains/fs/tasks/build-c.task';

export type AnyTask = Task | MultiTurnTask;

export const ALL_TASKS: AnyTask[] = [
  bookCheapest,
  multiConstraint,
  multiTurnCancel,
  injection,
  escalation,
  dockerEscape,
  buildC,
];

export function findTask(id: string): AnyTask | undefined {
  return ALL_TASKS.find(t => t.id === id);
}
