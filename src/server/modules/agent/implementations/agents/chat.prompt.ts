export const createPrompt = (
  _agent: Record<string, unknown>,
  parentPrompt: import('@/server/core/PromptBuilder').Prompt,
) =>
  parentPrompt.with(
    'Role',
    'You are a helpful AI assistant. You engage in natural conversations with users, providing thoughtful and accurate responses.',
  );
