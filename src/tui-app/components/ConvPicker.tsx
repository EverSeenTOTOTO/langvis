/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { useKeyboard } from '@/tui/hooks';
import { useStore } from '@/client/store';
import { Spinner } from '@/tui/components/Spinner';
import type { Conversation } from '@/shared/types/entities';

// `/conv` — this workspace's conversations (launch cwd). Enter switches
// (activates chat + persists conv-id); `d` y/n delete; list refreshes after delete.
export const ConvPicker = observer(function ConvPicker({
  onClose,
}: {
  onClose: () => void;
}) {
  const conversation = useStore('conversation');
  const [items, setItems] = useState<Conversation[]>([]);
  const [sel, setSel] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const fetchList = async (): Promise<Conversation[]> => {
    const list = await conversation.listByWorkspace({
      workspacePath: process.cwd(),
    });
    setItems(list);
    const idx = list.findIndex(
      c => c.id === conversation.currentConversationId,
    );
    setSel(idx >= 0 ? idx : 0);
    return list;
  };

  useEffect(() => {
    fetchList()
      .catch(e => setErr(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [conversation]);

  const currentId = conversation.currentConversationId;

  useKeyboard(data => {
    if (data === '\x1b' || data === 'q') {
      onClose();
      return;
    }
    if (confirmId) {
      if (data === 'y') {
        const target = confirmId;
        setConfirmId(null);
        void conversation
          .deleteConversation({ id: target })
          .then(() => fetchList())
          .catch(e => setErr(String(e instanceof Error ? e.message : e)));
      } else if (data === 'n') {
        setConfirmId(null);
      }
      return;
    }
    if (data === '\x1b[C' || data === '\x1b[B' || data === '\x0e') {
      setSel(s => (items.length ? (s + 1) % items.length : 0));
    } else if (data === '\x1b[D' || data === '\x1b[A' || data === '\x10') {
      setSel(s => (items.length ? (s - 1 + items.length) % items.length : 0));
    } else if (data === '\r') {
      const picked = items[sel];
      if (picked) {
        conversation.currentConversationId = picked.id;
        onClose();
      }
    } else if (data === 'd') {
      const picked = items[sel];
      if (picked) setConfirmId(picked.id);
    }
  });

  if (loading) {
    return <Spinner label="loading conversations…" />;
  }
  if (err) {
    return <Text fg="red">{` ${err} (q/Esc cancel)`}</Text>;
  }

  return (
    <Box flexDirection="column">
      {items.map((c, i) => {
        const isSel = i === sel;
        const isCur = c.id === currentId;
        const isConfirm = c.id === confirmId;
        return (
          <Box key={c.id} height={1}>
            <Text fg={isSel ? 'cyan' : 'gray'}>{isSel ? '› ' : '  '}</Text>
            {isConfirm ? (
              <Text fg="red">{`Delete '${c.name || c.id}'? (y/n)`}</Text>
            ) : (
              <>
                <Text
                  fg={isCur ? 'green' : isSel ? 'gray' : 'white'}
                  bold={isCur}
                >
                  {c.name || c.id}
                </Text>
                {isCur && <Text fg="green">{' ✓'}</Text>}
              </>
            )}
          </Box>
        );
      })}
      <Text fg="gray">
        {' ↑↓ move · Enter switch · d delete · q/Esc cancel'}
      </Text>
    </Box>
  );
});
