import { ToolConfig } from '@/shared/types';

export const config: ToolConfig<
  {
    message: string;
    formSchema: Record<string, unknown>;
    timeout?: number;
  },
  {
    submitted: boolean;
    data?: Record<string, unknown>;
  }
> = {
  name: 'HumanInTheLoop Tool',
  description:
    'Request human input during agent execution. Use this tool when you need user confirmation, decision making, or additional information to proceed. The agent will pause and wait for the user to submit the form before continuing.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'A clear message explaining what input is needed from the user.',
      },
      formSchema: {
        type: 'object',
        description:
          'JSON Schema describing the form fields to render for user input.',
      },
      timeout: {
        type: 'number',
        default: 3600000,
        description:
          'Maximum time to wait for user input in milliseconds. Default is 1 hour.',
        nullable: true,
      },
    },
    required: ['message', 'formSchema'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      submitted: {
        type: 'boolean',
        description: 'Whether the user submitted the form.',
      },
      data: {
        type: 'object',
        description: 'The form data submitted by the user.',
        nullable: true,
      },
    },
    required: ['submitted'],
  },
};
