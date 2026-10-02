import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface FileEditInput {
  path: string;
  old_string: string;
  new_string: string;
}

export interface FileEditOutput {
  oldString?: string;
  newString?: string;
  path: string;
  changes: number;
}

export const config: ToolConfig<FileEditInput, FileEditOutput> = {
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
          'The EXACT text to find — copy it verbatim from the file, including surrounding lines when needed to make it unique. Do not use omission placeholders like "(rest of ...)", "...", or "unchanged code".',
      },
      new_string: {
        type: 'string',
        description:
          'The replacement text, provided in full. Do not use omission placeholders — write out the complete replacement.',
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
      oldString: {
        type: 'string',
        nullable: true,
        description: 'Replaced text (for diff rendering).',
      },
      newString: {
        type: 'string',
        nullable: true,
        description: 'Replacement text (for diff rendering).',
      },
    },
    required: ['path', 'changes'],
  },
};

export const id = ToolIds.FILE_EDIT;
