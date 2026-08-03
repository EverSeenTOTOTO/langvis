/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Text } from '@/tui/components/Text';
import { getPrefetchPath, serverFetch } from '@/client/decorator/api';
import { isClient } from '@/shared/utils';
import { useStore } from '@/client/store';
import type { ConversationStore } from '@/client/store/modules/conversation';
import type { ModelStore } from '@/client/store/modules/model';
import { SignIn } from './screens/SignIn';
import { Chat } from './screens/Chat';

// Conv-id persistence: localStorage (web) or a file (CLI); injected to keep shell free of I/O.
export type ConvStorage = {
  getConvId: () => string | null;
  setConvId: (id: string) => void;
};

type BootState = { phase: 'boot' | 'ready' | 'error'; error?: string };

// True if a conversation with `id` exists (GET /api/conversation/:id 404s on
// unknown — the messages endpoint returns []). Network errors read as stale → create fallback.
async function conversationExists(id: string): Promise<boolean> {
  try {
    const fetchFn = await serverFetch.init();
    const resp = await fetchFn(getPrefetchPath(`/api/conversation/${id}`));
    return resp.ok;
  } catch {
    return false;
  }
}

async function defaultModelId(model: ModelStore): Promise<string> {
  const groups = (await model.getModels()) as Array<{
    models: Array<{ id: string }>;
  }>;
  return groups[0]?.models[0]?.id ?? 'localhost:default';
}

// Resume the stored conversation if it still exists, else create a fresh one in
// this workspace — either way the chat store auto-activates SSE from the id.
async function resumeOrCreate(
  conversation: ConversationStore,
  model: ModelStore,
  storage: ConvStorage,
): Promise<void> {
  const stored = storage.getConvId();
  if (stored && (await conversationExists(stored))) {
    conversation.currentConversationId = stored;
    return;
  }
  const conv = await conversation.createConversation({
    name: 'New Conversation',
    config: { model: { modelId: await defaultModelId(model) } },
    workspacePath: process.cwd(),
  });
  if (conv?.id) conversation.currentConversationId = conv.id;
}

function useBootstrap(storage: ConvStorage): BootState {
  const conversation = useStore('conversation');
  const model = useStore('model');
  const conversationGroup = useStore('conversationGroup');
  const [state, setState] = useState<BootState>({ phase: 'boot' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await resumeOrCreate(conversation, model, storage);
        // Background-load groups so /conv + StatusBar refresh without blocking boot.
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
  }, [conversation, model, conversationGroup, storage]);

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
