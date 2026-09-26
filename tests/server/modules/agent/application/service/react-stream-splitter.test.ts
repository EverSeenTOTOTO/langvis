import { describe, expect, it } from 'vitest';
import { ReActStreamSplitter } from '@/server/modules/agent/application/service/react-message';
import type { RunEvent } from '@/shared/types/events';

/** 按给定块大小把整段信封拆开喂入，聚合全部产出事件。 */
function feed(envelope: string, chunkSize = 3): RunEvent[] {
  const splitter = new ReActStreamSplitter();
  const events: RunEvent[] = [];
  for (let i = 0; i < envelope.length; i += chunkSize) {
    events.push(...splitter.push(envelope.slice(i, i + chunkSize)));
  }
  events.push(...splitter.flush());
  return events;
}

const textOf = (events: RunEvent[]) =>
  events
    .filter(e => e.type === 'text_chunk')
    .map(e => (e as { content: string }).content)
    .join('');

const thoughts = (events: RunEvent[]) =>
  events
    .filter(e => e.type === 'thought')
    .map(e => (e as { content: string }).content);

const RESPONSE_ENVELOPE = `<tool_call>
  <thought>先思考一下</thought>
  <tool>response_user</tool>
  <input>
    <message>你好，世界！</message>
  </input>
</tool_call>`;

const BASH_ENVELOPE = `<tool_call>
  <thought>查一下</thought>
  <tool>bash</tool>
  <input>
    <command>ls -la</command>
  </input>
</tool_call>`;

describe('ReActStreamSplitter（流式信封切分）', () => {
  it('thought 在闭合时整体发出；response_user 的 message 增量发 text_chunk', () => {
    const events = feed(RESPONSE_ENVELOPE);
    expect(thoughts(events)).toEqual(['先思考一下']);
    expect(textOf(events)).toBe('你好，世界！');
  });

  it('非 response_user 工具的参数不产 text_chunk（message 门控按 tool 名）', () => {
    const events = feed(BASH_ENVELOPE);
    expect(thoughts(events)).toEqual(['查一下']);
    expect(textOf(events)).toBe('');
  });

  it('任意切块边界下结果一致（标签/实体/多字节跨块）', () => {
    for (const size of [1, 2, 5, 17, 1000]) {
      const events = feed(RESPONSE_ENVELOPE, size);
      expect(thoughts(events), `chunk=${size}`).toEqual(['先思考一下']);
      expect(textOf(events), `chunk=${size}`).toBe('你好，世界！');
    }
  });

  it('message 内 XML 实体解码（含跨块的 &am/… 分片）', () => {
    const envelope = `<tool_call><tool>response_user</tool><input><message>a &lt; b &amp; c &quot;d&quot;</message></input></tool_call>`;
    for (const size of [1, 2, 3, 7, 1000]) {
      expect(textOf(feed(envelope, size)), `chunk=${size}`).toBe(
        'a < b & c "d"',
      );
    }
  });

  it('message 内 CDATA 直通（不解码实体）', () => {
    const envelope = `<tool_call><tool>response_user</tool><input><message><![CDATA[a & b < raw]]></message></input></tool_call>`;
    for (const size of [1, 4, 1000]) {
      expect(textOf(feed(envelope, size)), `chunk=${size}`).toBe('a & b < raw');
    }
  });

  it('无 thought 时只发 text_chunk；未闭合 message 在 flush 冲刷', () => {
    const events = feed(
      `<tool_call><tool>response_user</tool><input><message>没有闭合的消息`,
    );
    expect(textOf(events)).toBe('没有闭合的消息');
    expect(thoughts(events)).toEqual([]);
  });

  it('字面 < （模型未转义）按字面输出且不误判结束', () => {
    const envelope = `<tool_call><tool>response_user</tool><input><message>1 < 2 &lt; 3</message></input></tool_call>`;
    expect(textOf(feed(envelope, 3))).toBe('1 < 2 < 3');
  });
});
