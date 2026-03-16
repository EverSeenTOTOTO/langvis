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
  description: `Request human input during agent execution. This tool pauses the agent and displays a form to the user.

**When to use:**
- User confirmation needed (e.g., "Should I proceed with this action?")
- User decision among options (e.g., "Which option do you prefer?")
- Multi-selection from a list (e.g., "Which items to process?")
- Missing information required (e.g., "What is your preferred date?")
- Sensitive operations requiring approval

**How to construct formSchema:**
formSchema MUST be an object with fields defined in \`properties\`. Examples:

\`\`\`json
// Simple confirmation
{"type": "object", "properties": {"confirmed": {"type": "boolean", "title": "Confirm?"}}}

// Text input
{"type": "object", "properties": {"name": {"type": "string", "title": "Your name"}}}

// Single select (returns one value)
{"type": "object", "properties": {"choice": {"type": "string", "enum": ["option1", "option2"], "title": "Choose one"}}}

// Single select with labels
{"type": "object", "properties": {"category": {"type": "string", "enum": [{"label": "Tech Blog", "value": "tech"}, {"label": "News", "value": "news"}], "title": "Category"}}}

// Multi-select (returns array of values)
{"type": "object", "properties": {"selected": {"type": "array", "enum": ["url1", "url2", "url3"], "title": "Select items"}}}

// Multi-select with labels
{"type": "object", "properties": {"links": {"type": "array", "enum": [{"label": "Article A", "value": "url-a"}, {"label": "Article B", "value": "url-b"}], "title": "Select links to archive"}}}

// Multiple fields
{"type": "object", "properties": {"name": {"type": "string"}, "age": {"type": "number"}}}
\`\`\`

**Enum format:**
- Simple values: \`"enum": ["a", "b", "c"]\` - label equals value
- With labels: \`"enum": [{"label": "选项A", "value": "a"}, ...]\` - for i18n or friendly names

**Select vs Multi-select:**
- \`type: "string" + enum\` → single select dropdown
- \`type: "array" + enum\` → multi-select checkboxes
`,
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
        description: `JSON Schema describing the form. MUST be type "object" with fields in "properties".`,
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

