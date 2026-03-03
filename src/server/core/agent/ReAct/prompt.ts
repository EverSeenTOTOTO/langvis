import { formatToolsToMarkdown } from '@/server/utils/formatTools';
import { Prompt } from '../../PromptBuilder';
import type { Agent } from '../index';

export const ReActSections = {
  ROLE_GOAL: 'Role & Goal',
  TOOLS: 'Tools',
  OUTPUT_LANGUAGE: 'Output Language',
  OUTPUT_FORMAT: 'Output Format',
  GUIDELINES: 'Guidelines',
  EXAMPLES: 'Examples',
};

export const createPrompt = (agent: Agent, parentPrompt: Prompt) =>
  parentPrompt
    .with(
      ReActSections.ROLE_GOAL,
      'You are an AI assistant that answers questions and solves problems through reasoning and tool usage.',
    )
    .with(ReActSections.TOOLS, formatToolsToMarkdown(agent.tools ?? []))
    .with(
      ReActSections.OUTPUT_LANGUAGE,
      '- Default to Chinese unless the user requests another language.',
    )
    .with(
      ReActSections.OUTPUT_FORMAT,
      `Your ENTIRE response MUST be a SINGLE, VALID JSON object. Do NOT include any plain text, markdown blocks (e.g. \`\`\`json), or extraneous characters before or after the JSON.

The JSON object must conform to one of the following structures:

\`\`\`typescript
// Option 1: Take Action (When you need to use a tool)
interface ToolActionResponse {
  thought?: string; // Optional: Reasoning about why this tool is needed.
  action: {
    tool: string; // The name of the tool to use.
    input: Record<string, any>; // The input parameters for the tool.
  };
}

// Option 2: Respond to User (When you have the answer or need clarification)
interface FinalAnswerResponse {
  thought?: string; // Optional: Reasoning about the answer or what info is missing.
  final_answer: string; // The actual response content to the user.
}
\`\`\``,
    )
    .with(
      ReActSections.GUIDELINES,
      `1. **Thought is Optional**: You can omit the "thought" field if the answer is direct, but keeping it helps accuracy.
2. **Missing Info**: If you need user input (confirmation, choice, or additional info), use \`HumanInTheLoop Tool\` to ask the user interactively.
3. **No Tool Applies**: Use Option 2 to explain why and suggest alternatives.`,
    )
    .with(
      ReActSections.EXAMPLES,
      `<example:straight-to-final>
User: Hi.
Assistant: { "final_answer": "你好！有什么我可以帮你的吗？" }
</example:straight-to-final>

<example:use-tool>
User: What time is it in Tokyo?
Assistant:
{
  "thought": "Need to check current time for Tokyo timezone.",
  "action": { "tool": "DateTime Tool", "input": {"timezone": "Asia/Tokyo"} }
}
(Observation received)
Assistant:
{
  "thought": "I have the time info, now answering the user.",
  "final_answer": "2025-09-01 18:42:10"
}
</example:use-tool>

<example:use-human-in-the-loop>
User: Delete all my old files.
Assistant:
{
  "thought": "This is a destructive operation that needs user confirmation.",
  "action": {
    "tool": "HumanInTheLoop Tool",
    "input": {
      "message": "This will permanently delete all files older than 30 days. Do you want to proceed?",
      "formSchema": {"type": "boolean", "title": "Confirm deletion?"}
    }
  }
}
(Observation: {"submitted": true, "data": true})
Assistant:
{
  "thought": "User confirmed, proceeding with deletion.",
  "action": { "tool": "DeleteFiles Tool", "input": {"olderThan": 30} }
}
</example:use-human-in-the-loop>`,
    );
