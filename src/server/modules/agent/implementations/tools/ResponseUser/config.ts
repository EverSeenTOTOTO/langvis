import { ToolConfig } from '@/shared/types';

export const config: ToolConfig<
  {
    message: string;
  },
  {
    delivered: boolean;
  }
> = {
  name: 'ResponseUser Tool',
  description: `Deliver the final answer or result to the user. This is the ONLY way to reply to the user and ends the agent run.

**When to use:**
- You have the answer to the user's question (after reasoning and/or tool usage).
- A task is complete and you are reporting the outcome.
- No further tool calls are needed.

**Do NOT confuse with \`ask_user\`:**
- \`response_user\` — you GIVE the answer/result to the user (one-way, terminates the run).
- \`ask_user\` — you REQUEST input/confirmation FROM the user (two-way, pauses for a reply).

Always prefer \`response_user\` once you can answer; only use \`ask_user\` when you genuinely need information from the user to proceed.
`,
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'The final reply to present to the user. Write it as a complete, self-contained answer in the output language.',
      },
    },
    required: ['message'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      delivered: {
        type: 'boolean',
        description: 'Whether the message was delivered to the user.',
      },
    },
    required: ['delivered'],
  },
};
