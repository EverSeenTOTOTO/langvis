import { describe, expect, it } from 'vitest';

import { parseResponse } from '@/server/modules/agent/application/service/react-loop';

describe('parseResponse', () => {
  it('parses a clean bare JSON object', () => {
    expect(parseResponse('{ "tool": "datetime_get", "input": {} }')).toEqual({
      thought: undefined,
      tool: 'datetime_get',
      input: {},
    });
  });

  it('parses a fenced ```json block', () => {
    expect(
      parseResponse('```json\n{ "tool": "datetime_get", "input": {} }\n```'),
    ).toEqual({
      thought: undefined,
      tool: 'datetime_get',
      input: {},
    });
  });

  it('preserves an optional thought field', () => {
    expect(
      parseResponse('{"thought":"let me check","tool":"x","input":{}}'),
    ).toEqual({
      thought: 'let me check',
      tool: 'x',
      input: {},
    });
  });

  // Regression: GLM-5.2 (thinking model) leakage seen in production logs —
  // leading reasoning fragments and <think> remnants before the tool-call JSON.
  it.each([
    ['bare prefix token "me."', 'me.{ "tool": "datetime_get", "input": {} }'],
    [
      'bare prefix token "ON."',
      'ON.{"tool":"response_user","input":{"message":"hi"}}',
    ],
    [
      'bare prefix token "it."',
      'it.{"tool":"response_user","input":{"message":"hi"}}',
    ],
    [
      'think remnant + fence',
      'ally afternoon.</think>```json\n{ "tool": "response_user", "input": { "message": "Good morning" } }\n```',
    ],
    [
      'think remnant + raw JSON',
      'me.{"tool":"response_user","input":{"message":"Good morning"}}',
    ],
  ])('tolerates %s', (_label, content) => {
    const parsed = parseResponse(content);
    expect(parsed.tool).toMatch(/^(datetime_get|response_user)$/);
    expect(parsed.input).toBeTypeOf('object');
  });

  it('does not let braces inside a <think> block hijack extraction', () => {
    const parsed = parseResponse(
      '<think>maybe {"tool":"wrong"} here</think>{"tool":"response_user","input":{"message":"ok"}}',
    );
    expect(parsed.tool).toBe('response_user');
  });

  it('does not corrupt a string value containing triple backticks', () => {
    const parsed = parseResponse(
      '{"tool":"response_user","input":{"code":"```python"}}',
    );
    expect((parsed.input as { code: string }).code).toBe('```python');
  });

  it('preserves a literal </think> inside a JSON string value', () => {
    const parsed = parseResponse(
      '{"tool":"response_user","input":{"message":"use </think> here"}}',
    );
    expect((parsed.input as { message: string }).message).toBe(
      'use </think> here',
    );
  });

  it('throws when there is no JSON object', () => {
    expect(() => parseResponse('just prose, no json here')).toThrow();
  });

  it('throws when tool/input is missing', () => {
    expect(() => parseResponse('{"foo":"bar"}')).toThrow();
  });
});
