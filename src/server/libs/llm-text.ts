// Strip <thinking> reasoning so it never reaches tool parsing or history. Matches thinking tags only.
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
