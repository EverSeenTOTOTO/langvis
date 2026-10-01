import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface BashInput {
  command: string;
  timeout?: number;
  /** true：不阻塞等待，立即返回 taskId；后续经 wait 拉增量、kill 终止。 */
  background?: boolean;
  /** 拉取后台任务未读增量（tail 限最大字符数）。 */
  wait?: { taskId: string; tail?: number };
  /** 终止后台任务。 */
  kill?: { taskId: string };
}

export interface BashOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  /** 后台模式：任务句柄与当前状态。 */
  background?: {
    taskId: string;
    running: boolean;
    exitCode: number | null;
  };
}

// ajv 无法完整推导嵌套 nullable 对象的 JSONSchemaType——outputSchema 形状经运行时校验保障

export const config = {
  name: 'bash',
  description:
    'Execute a shell command in the workspace directory. Read-only commands confined to the workspace run without confirmation; anything else (writes, execution, out-of-workspace paths, shell metacharacters) requires user approval. In sub-agent runs only already-approved commands run — the rest fail fast. Prefer modern CLI tools: use `rg` instead of `grep`, `fd` instead of `find`, `lsd` instead of `ls`, `bat` instead of `cat`.',
  untrustedOutput: true,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      timeout: {
        type: 'number',
        nullable: true,
        description:
          'Suggested timeout in seconds (default 60, max 600). User can adjust during confirmation.',
      },
      background: {
        type: 'boolean',
        nullable: true,
        description:
          'Run without blocking: returns a taskId immediately. Combine with `wait`/`kill` in later bash calls to drain output or terminate. Use for long-running tasks (servers, watchers, builds).',
      },
      wait: {
        type: 'object',
        nullable: true,
        description:
          'Drain unread output from a background task since your last wait. Use in a loop until running=false.',
        properties: {
          taskId: { type: 'string' },
          tail: {
            type: 'number',
            nullable: true,
            description: 'Cap returned characters to the most recent N.',
          },
        },
        required: ['taskId'],
      },
      kill: {
        type: 'object',
        nullable: true,
        description: 'Terminate a background task (SIGTERM→SIGKILL).',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
    },
    required: ['command'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      exitCode: { type: 'number', description: 'Process exit code.' },
      stdout: {
        type: 'string',
        description: 'Standard output (truncated at 1MB).',
      },
      stderr: {
        type: 'string',
        description: 'Standard error output (truncated at 1MB).',
      },
      timedOut: {
        type: 'boolean',
        nullable: true,
        description: 'True if the process was killed due to timeout.',
      },
      background: {
        type: 'object',
        nullable: true,
        description:
          'Present when launched with background:true — taskId plus current running state.',
        properties: {
          taskId: { type: 'string' },
          running: { type: 'boolean' },
          exitCode: { type: 'number', nullable: true },
        },
        required: ['taskId', 'running'],
        additionalProperties: false,
      },
    },
    required: ['exitCode', 'stdout', 'stderr'],
  },
} as unknown as ToolConfig<BashInput, BashOutput>;

export const id = ToolIds.BASH;
