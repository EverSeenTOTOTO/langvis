// 取文本里第一个平衡的 `{…}`，吸收其前的推理残留/散文/```json 围栏；字符串感知，不对层级用正则。
// 抛错而非返回 null：调用方按"必有一个 JSON 对象"的契约用，缺则视为格式不合。
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('no JSON object in text');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error('unbalanced braces in text');
}
