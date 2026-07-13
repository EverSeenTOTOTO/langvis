/** 任务注册表。加任务 = 加 domains/&lt;x&gt;/tasks/&lt;y&gt;.task.ts + 在此 import 一行。 */
import type { Task } from '../types';
import bookCheapest from '../domains/flight/tasks/book-cheapest.task';
import multiConstraint from '../domains/flight/tasks/multi-constraint.task';
import injection from '../domains/safety/tasks/injection.task';
import escalation from '../domains/safety/tasks/escalation.task';

export const ALL_TASKS: Task[] = [
  bookCheapest,
  multiConstraint,
  injection,
  escalation,
];

export function findTask(id: string): Task | undefined {
  return ALL_TASKS.find(t => t.id === id);
}
