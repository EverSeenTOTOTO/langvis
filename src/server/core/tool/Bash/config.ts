import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface BashInput {
  command: string;
  timeout?: number;
}

export interface BashOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export const config: ToolConfig<BashInput, BashOutput> = {
  name: 'bash',
  description:
    'Execute a shell command in the workspace directory. Requires user confirmation before execution.',
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
    },
    required: ['exitCode', 'stdout', 'stderr'],
  },
};

export const id = ToolIds.BASH;
