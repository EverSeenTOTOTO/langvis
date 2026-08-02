/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Text } from '@/tui/components/Text';
import { getPrefetchPath, serverFetch } from '@/client/decorator/api';
import { isClient } from '@/shared/utils';
import { useStore } from '@/client/store';
import { SignIn } from './screens/SignIn';
import { Chat } from './screens/Chat';

// Conv-id persistence: localStorage (web) or a file (CLI); injected to keep shell free of I/O.
export type ConvStorage = {
  getConvId: () => string | null;
  setConvId: (id: string) => void;
};

// Create-or-reuse a conversation and point the store at it (chat store auto-activates SSE).
function useBootstrap(storage: ConvStorage): {
  phase: 'boot' | 'ready' | 'error';
  error?: string;
} {
  const conversation = useStore('conversation');
  const model = useStore('model');
  const conversationGroup = useStore('conversationGroup');
  const [state, setState] = useState<{
    phase: 'boot' | 'ready' | 'error';
    error?: string;
  }>({ phase: 'boot' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = storage.getConvId();
        let reused = false;
        if (stored) {
          try {
            // Validate the stored id (GET /api/conversation/:id 404s on unknown;
            // the messages endpoint returns [] and can't distinguish stale).
            const fetchFn = await serverFetch.init();
            const resp = await fetchFn(
              getPrefetchPath(`/api/conversation/${stored}`),
            );
            if (resp.ok) {
              conversation.currentConversationId = stored;
              reused = true;
            }
          } catch {
            // network error falls through to create
          }
        }
        if (!reused) {
          const groups = (await model.getModels()) as Array<{
            models: Array<{ id: string }>;
          }>;
          const modelId = groups[0]?.models[0]?.id ?? 'localhost:default';
          const conv = await conversation.createConversation({
            name: 'New Conversation',
            config: { model: { modelId } },
            workspacePath: process.cwd(),
          });
          if (conv?.id) {
            conversation.currentConversationId = conv.id;
          }
        }
        // Load conversations in the background so the boot screen isn't held on
        // that roundtrip — the /conv list and StatusBar refresh when it lands.
        void conversationGroup.getAllGroups().catch(() => {});
        if (!cancelled) setState({ phase: 'ready' });
      } catch (e) {
        if (!cancelled) {
          setState({
            phase: 'error',
            error: String(e instanceof Error ? e.message : e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation, model, storage]);

  return state;
}

const ChatScreen = observer(function ChatScreen({
  storage,
}: {
  storage: ConvStorage;
}) {
  const { phase, error } = useBootstrap(storage);
  if (phase === 'boot') return <Text fg="gray">{'connecting…'}</Text>;
  if (phase === 'error') return <Text fg="red">{`error: ${error ?? ''}`}</Text>;
  return <Chat />;
});

export const Root = observer(function Root({
  storage,
}: {
  storage: ConvStorage;
}) {
  const auth = useStore('auth');
  const user = useStore('user');
  const [checked, setChecked] = useState(false);
  const [connErr, setConnErr] = useState<string | null>(null);

  useEffect(() => {
    // Probe the backend before auth so a down server surfaces an explicit
    // message instead of silently falling through to the sign-in screen.
    const base = isClient() ? window.location.origin : getPrefetchPath('');
    let cancelled = false;
    fetch(base)
      .then(() => {
        if (!cancelled) void auth.getSession().finally(() => setChecked(true));
      })
      .catch(e => {
        if (cancelled) return;
        setConnErr(
          `Cannot reach backend at ${base} (${
            e instanceof Error ? e.message : String(e)
          }). Is the server running?`,
        );
        setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  if (!checked) return <Text fg="gray">{'connecting…'}</Text>;
  if (connErr) return <Text fg="red">{connErr}</Text>;
  if (!user.currentUser) return <SignIn />;
  return <ChatScreen storage={storage} />;
});
