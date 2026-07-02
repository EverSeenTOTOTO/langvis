import { describe, expect, it } from 'vitest';

import { stripThinking } from '@/server/libs/llm-text';

describe('stripThinking', () => {
  it('removes a full paired <think> block', () => {
    expect(stripThinking('<think>hidden reasoning</think>{"tool":"x"}')).toBe(
      '{"tool":"x"}',
    );
  });

  it('removes a leading remnant whose opening tag was consumed upstream', () => {
    expect(stripThinking('ally afternoon.</think>```json{"tool":"x"}```')).toBe(
      '```json{"tool":"x"}```',
    );
  });

  it('removes a stray closing tag', () => {
    expect(stripThinking('</think>hello')).toBe('hello');
  });

  it('drops an unclosed <think> to end of string', () => {
    expect(stripThinking('before<think>rest of reasoning')).toBe('before');
  });

  it('returns content unchanged when there are no think tags', () => {
    expect(stripThinking('{"tool":"x","input":{}}')).toBe(
      '{"tool":"x","input":{}}',
    );
  });

  it('preserves a literal </think> inside a JSON string value', () => {
    const content = '{"message":"close with </think> now"}';
    expect(stripThinking(content)).toBe(content);
  });
});
