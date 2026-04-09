import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface WriteFileOutput {
  path: string;
  size: number;
}

export const config: ToolConfig<WriteFileInput, WriteFileOutput> = {
  name: 'file_write',
  description:
    'Create a new file in the workspace. Requires user confirmation. Will fail if the file already exists — use edit_file to modify existing files.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'File path relative to the workspace directory. Intermediate directories are created automatically.',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file.',
      },
    },
    required: ['path', 'content'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the created file.',
      },
      size: {
        type: 'number',
        description: 'Size of the written content in bytes.',
      },
    },
    required: ['path', 'size'],
  },
};

export const id = ToolIds.FILE_WRITE;
