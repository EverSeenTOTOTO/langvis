import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface ReadFileInput {
  path: string;
}

export interface ReadFileOutput {
  content: string;
  size: number;
  path: string;
}

export const config: ToolConfig<ReadFileInput, ReadFileOutput> = {
  name: 'file_read',
  description:
    'Read a file from the workspace. Files larger than 1MB will be rejected — use bash tool with head, tail, sed, or rg instead.',
  untrustedOutput: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'File path relative to the workspace directory, e.g. "data/config.json".',
      },
    },
    required: ['path'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'File content as text.' },
      size: { type: 'number', description: 'File size in bytes.' },
      path: { type: 'string', description: 'Relative path of the file.' },
    },
    required: ['content', 'size', 'path'],
  },
};

export const id = ToolIds.FILE_READ;
