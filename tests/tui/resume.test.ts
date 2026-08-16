import { describe, expect, it } from 'vitest';
import { isResumableMessage, findResumableMessages } from '@/tui/libs/resume';
import { Role, type Message } from '@/shared/types/entities';

const msg = (
  id: string,
  role: Role,
  content: string,
  meta?: unknown,
): Message =>
  ({
    id,
    conversationId: 'cv',
    role,
    content,
    meta: meta ?? null,
    createdAt: new Date(0),
  }) as Message;

describe('isResumableMessage', () => {
  it('includes real user messages', () => {
    expect(isResumableMessage(msg('m1', Role.USER, 'hello'))).toBe(true);
  });

  it('excludes assistant and system messages', () => {
    expect(isResumableMessage(msg('a1', Role.ASSIST, 'hi'))).toBe(false);
    expect(isResumableMessage(msg('s1', Role.SYSTEM, 'sys'))).toBe(false);
  });

  it('excludes blank content, the session-context header, and compact summaries', () => {
    expect(isResumableMessage(msg('m2', Role.USER, '   '))).toBe(false);
    expect(
      isResumableMessage(
        msg('c1', Role.USER, '<session-context>', { kind: 'context' }),
      ),
    ).toBe(false);
    expect(
      isResumableMessage(
        msg('cp1', Role.USER, 'folded summary…', { kind: 'compact' }),
      ),
    ).toBe(false);
  });
});

describe('findResumableMessages', () => {
  it('filters to real user messages (no scaffolding) and returns them newest-first', () => {
    const messages = [
      msg('ctx', Role.USER, '<session-context>', { kind: 'context' }),
      msg('cp1', Role.USER, 'folded summary…', { kind: 'compact' }),
      msg('u1', Role.USER, 'first'),
      msg('a1', Role.ASSIST, 'reply'),
      msg('u2', Role.USER, 'second'),
    ];
    expect(findResumableMessages(messages).map(m => m.id)).toEqual([
      'u2',
      'u1',
    ]);
  });
});
