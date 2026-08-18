/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { useKeyboard } from '@/tui/hooks/useKeyboard';
import { isKey } from '@/tui/libs/keys';
import { useStore } from '@/client/store';
import { findResumableMessages } from '@/tui/libs/resume';
import { truncate } from '@/tui/libs/wrap';
import type { Message } from '@/shared/types/entities';

// `/resume` — pick a past user message (newest first) to retry from: truncates
// that message and everything after it, and prefills the input with its text.
export const ResumePicker = observer(function ResumePicker({
  onPick,
  onClose,
}: {
  onPick: (msg: Message) => void;
  onClose: () => void;
}) {
  const conversation = useStore('conversation');
  const convId = conversation.currentConversationId;

  const items = useMemo(
    () => findResumableMessages(conversation.messages[convId ?? ''] ?? []),
    [conversation.messages[convId ?? ''], convId],
  );
  const [sel, setSel] = useState(0);

  useKeyboard(data => {
    if (isKey(data, 'close')) {
      onClose();
      return;
    }
    if (isKey(data, 'down') || isKey(data, 'right')) {
      setSel(s => (items.length ? (s + 1) % items.length : 0));
    } else if (isKey(data, 'up') || isKey(data, 'left')) {
      setSel(s => (items.length ? (s - 1 + items.length) % items.length : 0));
    } else if (isKey(data, 'enter')) {
      const picked = items[sel];
      if (picked) {
        onPick(picked);
        onClose();
      }
    }
  });

  if (!convId || items.length === 0) {
    return <Text fg="gray">{' no resumable messages (q/Esc cancel)'}</Text>;
  }

  return (
    <Box flexDirection="column">
      {items.map((m, i) => {
        const isSel = i === sel;
        // Collapse newlines/whitespace to one line, then clip long text w/ ….
        const preview = truncate(m.content.replace(/\s+/g, ' ').trim(), 60);
        return (
          <Box key={m.id} height={1}>
            <Text fg={isSel ? 'cyan' : 'gray'}>{isSel ? '› ' : '  '}</Text>
            <Text fg={isSel ? 'gray' : 'white'}>{preview}</Text>
          </Box>
        );
      })}
      <Text fg="gray">{' ↑↓ move · Enter pick · q/Esc cancel'}</Text>
    </Box>
  );
});
