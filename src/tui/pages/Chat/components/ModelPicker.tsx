/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { useKeyboard } from '@/tui/hooks/useKeyboard';
import { useStore } from '@/client/store';
import { Spinner } from '@/tui/components/Spinner';

type ModelEntry = { id: string; name: string };

// `/model` — flat model list as `provider:modelId`. Enter rebinds the conversation's model.
export const ModelPicker = observer(function ModelPicker({
  onClose,
}: {
  onClose: () => void;
}) {
  const conversation = useStore('conversation');
  const model = useStore('model');
  const [items, setItems] = useState<ModelEntry[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const groups = (await model.getModels()) as Array<{
          models: ModelEntry[];
        }>;
        const flat = groups.flatMap(g => g.models ?? []);
        if (!cancelled) {
          setItems(flat);
          const curId = (
            conversation.currentConversation?.config as {
              model?: { modelId?: string };
            } | null
          )?.model?.modelId;
          const idx = flat.findIndex(m => m.id === curId);
          setSel(idx >= 0 ? idx : 0);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model]);

  const current = (
    conversation.currentConversation?.config as {
      model?: { modelId?: string };
    } | null
  )?.model?.modelId;

  useKeyboard(data => {
    if (data === '\x1b' || data === 'q') {
      onClose();
      return;
    }
    if (data === '\x1b[C' || data === '\x1b[B' || data === '\x0e') {
      setSel(s => (items.length ? (s + 1) % items.length : 0));
    } else if (data === '\x1b[D' || data === '\x1b[A' || data === '\x10') {
      setSel(s => (items.length ? (s - 1 + items.length) % items.length : 0));
    } else if (data === '\r') {
      const picked = items[sel];
      const conv = conversation.currentConversation;
      if (picked && conv) {
        const cfg = (conv.config ?? {}) as Record<string, unknown>;
        const curModel = (cfg.model as { modelId?: string }) ?? {};
        void conversation.updateConversation({
          id: conv.id,
          name: conv.name,
          config: { ...cfg, model: { ...curModel, modelId: picked.id } },
        });
        onClose();
      }
    }
  });

  if (loading) {
    return <Spinner label="loading models…" />;
  }
  if (err) {
    return <Text fg="red">{` ${err} (q/Esc cancel)`}</Text>;
  }

  return (
    <Box flexDirection="column">
      {items.map((m, i) => {
        const isSel = i === sel;
        const isCur = m.id === current;
        return (
          <Box key={m.id} height={1}>
            <Text fg={isSel ? 'cyan' : 'gray'}>{isSel ? '› ' : '  '}</Text>
            <Text fg={isCur ? 'green' : isSel ? 'gray' : 'white'} bold={isCur}>
              {m.id}
            </Text>
            {m.name && m.name !== m.id && (
              <Text fg="gray">{`  ${m.name}`}</Text>
            )}
            {isCur && <Text fg="green">{' ✓'}</Text>}
          </Box>
        );
      })}
      <Text fg="gray">{' ↑↓ move · Enter select · q/Esc cancel'}</Text>
    </Box>
  );
});
