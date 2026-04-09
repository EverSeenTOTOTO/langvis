import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface EditFileInput {
  path: string;
  old_string: string;
  new_string: string;
}

export interface EditFileOutput {
  path: string;
  changes: number;
}

export const config: ToolConfig<EditFileInput, EditFileOutput> = {
  name: 'file_edit',
  description:
    'Edit an existing file by replacing text. Requires user confirmation. Only the first occurrence of old_string is replaced. Use for precise, targeted modifications.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to the workspace directory.',
      },
      old_string: {
        type: 'string',
        description:
          'Exact text to find and replace. Must match the file content exactly.',
      },
      new_string: {
        type: 'string',
        description: 'Replacement text.',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the edited file.',
      },
      changes: {
        type: 'number',
        description: 'Number of replacements made.',
      },
    },
    required: ['path', 'changes'],
  },
};

export const id = ToolIds.FILE_EDIT;
