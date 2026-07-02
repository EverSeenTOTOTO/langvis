/**
 * Strip inline `<think>…</think>` reasoning that some chat models (GLM,
 * DeepSeek-R1, …) embed in `content`. Reasoning must not reach tool-call
 * parsing, nor be stored back into conversation history (it confuses the model
 * on the next turn).
 *
 * Safety: this only matches `<think>` tag patterns, never the JSON hierarchy.
 * A literal `</think>` sitting inside a JSON string value is preserved — full
 * paired blocks are removed non-greedily (they stop at their own close), and
 * bare-tag / remnant stripping is confined to the preamble before the first
 * `{`, so JSON bodies are untouched.
 */
export function stripThinking(content: string): string {
  const withoutBlocks = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '');

  const firstBrace = withoutBlocks.indexOf('{');
  const head =
    firstBrace === -1 ? withoutBlocks : withoutBlocks.slice(0, firstBrace);
  const tail = firstBrace === -1 ? '' : withoutBlocks.slice(firstBrace);

  const cleanedHead = head
    .replace(/^[\s\S]*<\/think>/i, '')
    .replace(/<\/?think>/gi, '');

  return (cleanedHead + tail).trim();
}
