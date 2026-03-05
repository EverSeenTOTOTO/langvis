import { ToolConfig } from '@/shared/types';

export const config: ToolConfig<
  {
    conversationId: string;
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
  description: `Request human input during agent execution. This tool pauses the agent and displays a form to the user.

**When to use:**
- User confirmation needed (e.g., "Should I proceed with this action?")
- User decision among options (e.g., "Which option do you prefer?")
- Missing information required (e.g., "What is your preferred date?")
- Sensitive operations requiring approval

**How to construct formSchema:**
formSchema MUST be an object with fields defined in \`properties\`. Examples:

\`\`\`json
// Simple confirmation
{"type": "object", "properties": {"confirmed": {"type": "boolean", "title": "Confirm?"}}}

// Text input
{"type": "object", "properties": {"name": {"type": "string", "title": "Your name"}}}

// Multiple choice
{"type": "object", "properties": {"choice": {"type": "string", "enum": ["option1", "option2"], "title": "Choose one"}}}

// Multiple fields
{"type": "object", "properties": {"name": {"type": "string"}, "age": {"type": "number"}}}
\`\`\`

**Output:**
- \`submitted: true, data: {...}\` - User submitted the form with their input (data contains the object with all field values)
- \`submitted: false\` - User did not respond (timeout or cancelled)`,
  inputSchema: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description:
          'The conversation ID to associate with this input request.',
      },
      message: {
        type: 'string',
        description:
          'A clear message explaining what input is needed from the user.',
      },
      formSchema: {
        type: 'object',
        description: `JSON Schema describing the form. MUST be type "object" with fields in "properties". Examples:
{"type": "object", "properties": {"confirmed": {"type": "boolean", "title": "Confirm?"}}}
{"type": "object", "properties": {"value": {"type": "string", "title": "Enter value"}}}
{"type": "object", "properties": {"choice": {"type": "string", "enum": ["a", "b"], "title": "Select"}}}`,
      },
      timeout: {
        type: 'number',
        default: 3600000,
        description:
          'Maximum time to wait for user input in milliseconds. Default is 1 hour.',
        nullable: true,
      },
    },
    required: ['conversationId', 'message', 'formSchema'],
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
