/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner } from '@/tui/components/Spinner';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { Static } from '@/tui/components/Static';
import { useKeyboard } from '@/tui/hooks/useKeyboard';
import { useTerminalSize } from '@/tui/hooks/useTerminalSize';
import { useStore } from '@/client/store';
import { Role, type Message } from '@/shared/types/entities';
import { AssistantView, UserView, AVATAR_GAP } from './components/MessageView';
import { AskUserForm } from './components/AskUserForm';
import { ModelPicker } from './components/ModelPicker';
import { ConvPicker } from './components/ConvPicker';
import { ResumePicker } from './components/ResumePicker';
import { ChatInput } from './components/ChatInput';
import { StatusBar } from './components/StatusBar';
import { useStaticReveal } from './hooks/useStaticReveal';

// Bottom panel is in exactly one of these modes at a time. `busy` covers every
// non-functional state (input disabled); sources live in their natural layers.
type BottomMode =
  | { kind: 'ask' }
  | { kind: 'model' }
  | { kind: 'conv' }
  | { kind: 'resume' }
  | { kind: 'busy'; label: string }
  | { kind: 'input' };

function isVisible(m: Message): boolean {
  if (m.role === Role.SYSTEM) return false;
  const kind = m.meta?.kind;
  return kind !== 'context' && kind !== 'compact';
}

/** A full-width horizontal rule — used to border the input area. */
function HRule({ cols }: { cols: number }) {
  return (
    <Box height={1}>
      <Text fg="gray">{'─'.repeat(Math.max(0, cols))}</Text>
    </Box>
  );
}

// Ink's <Static> region is append-only and can't erase itself — on conversation
// switch the previous conv's scrollback lingers. Clear the screen + scrollback.
const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';

export const Chat = observer(function Chat() {
  const conversation = useStore('conversation');
  const chat = useStore('chat');
  const model = useStore('model');
  const auth = useStore('auth');
  const { cols } = useTerminalSize();
  const convId = conversation.currentConversationId;
  const [picker, setPicker] = useState<null | 'model' | 'conv' | 'resume'>(
    null,
  );
  const [notice, setNotice] = useState('');
  const [prefill, setPrefill] = useState('');
  const [expanded, setExpanded] = useState(false);

  // Wipe stale Static scrollback on conversation switch; bump remountKey so the
  // Static remounts and re-emits the new conv's history after the clear.
  const prevConv = useRef<string | undefined>(undefined);
  const [remountKey, setRemountKey] = useState(0);
  useEffect(() => {
    if (prevConv.current !== undefined && prevConv.current !== convId) {
      process.stdout.write(CLEAR_SCREEN);
      setRemountKey(k => k + 1);
    }
    prevConv.current = convId;
  }, [convId]);

  // Derive the committed (non-streaming) list up front — the reveal hook below
  // depends on its length, and all of this is null-safe before a conv is loaded.
  const id = convId ?? '';
  const all = (conversation.messages[id] ?? []).filter(isVisible);

  let streamingId: string | null = null;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].role !== Role.ASSIST) continue;
    const node = chat.getMessageNode(id, all[i].id);
    if (node && !node.isTerminal && i === all.length - 1) {
      streamingId = all[i].id;
    }
    break;
  }

  const committed = streamingId ? all.filter(m => m.id !== streamingId) : all;

  // History renders off-thread (worker) and appends as each message is ready;
  // content + width must match AssistantView's Markdown so the cache key lines up.
  const msgWidth = Math.max(1, cols - AVATAR_GAP);
  const contentOf = (m: Message) =>
    chat.getMessageNode(id, m.id)?.content ?? m.content;
  const staticItems = useStaticReveal(
    committed,
    msgWidth,
    `${id}:${remountKey}`,
    contentOf,
  );

  async function createNew() {
    // 模型挑选是附带增强；失败降级默认模型，不阻断创建与切换。
    let modelId = 'localhost:default';
    try {
      const groups = (await model.getModels()) as Array<{
        models: Array<{ id: string }>;
      }>;
      modelId = groups[0]?.models[0]?.id ?? 'localhost:default';
    } catch {
      /* fallback to default */
    }
    try {
      const conv = await conversation.createConversation({
        name: 'New Conversation',
        config: { model: { modelId } },
        workspacePath: process.cwd(),
      });
      if (!conv?.id) {
        setNotice('new failed: no conversation returned');
      } else {
        conversation.currentConversationId = conv.id;
      }
    } catch (e) {
      setNotice(`new failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleResumePick(msg: { id: string; content: string }) {
    if (!convId) return;
    // 截断本地即同步生效（本地先删）。Ink <Static> 是只追加的，删掉的消息无法自行
    // 擦除——像切会话一样清屏 + 重挂，让 Static 重发截断后的剩余历史。
    chat.truncateMessages({ conversationId: convId, messageId: msg.id });
    process.stdout.write(CLEAR_SCREEN);
    setRemountKey(k => k + 1);
    setPrefill(msg.content);
  }

  function handleCommand(raw: string) {
    const cmd = raw.trim().toLowerCase();
    setNotice('');
    if (cmd === '/model') setPicker('model');
    else if (cmd === '/conv') setPicker('conv');
    else if (cmd === '/resume') setPicker('resume');
    else if (cmd === '/new') void createNew();
    else if (cmd === '/logout') {
      // Clear local state first (lands on SignIn even if the server call fails),
      // then best-effort invalidate the remote session; cli.tsx drops the cookie.
      auth.logoutLocal();
      void auth.signOut({}).catch(() => {});
    } else if (cmd === '/' || cmd === '/help') {
      setNotice('commands: /model  /conv  /new  /resume  /logout');
    } else {
      setNotice(`unknown command: ${raw.trim()}`);
    }
  }

  // Cancel the in-flight turn from any bottom-panel state (thinking spinner /
  // ask / streaming / picker): panel-specific handlers unmount, so own it here.
  const streamCancelRef = useRef<(() => void) | null>(null);
  useKeyboard(data => {
    if (data === '\x03') streamCancelRef.current?.();
  });

  // Ctrl+O toggles full tool detail for the current (streaming) turn.
  useKeyboard(data => {
    if (data === '\x0f') setExpanded(v => !v);
  });

  if (!convId) return null;

  // Wire the global cancel handler to the in-flight turn (if any).
  streamCancelRef.current = streamingId
    ? () =>
        void chat.cancelChat({ conversationId: convId, messageId: streamingId })
    : null;

  const streamingNode = streamingId
    ? chat.getMessageNode(convId, streamingId)
    : null;
  const activating = chat.isTransportConnecting && !streamingId;

  // Only the in-flight turn is live (not Static); committed turns go to Static so
  // the dynamic region stays under the viewport and Ink 7 never full-clears.
  const liveNode = streamingNode;

  // Bottom-panel mode — one discriminated value, priority ask > picker > busy
  // > input; busy sources read from their own layers and merged only here.
  const mode: BottomMode = (() => {
    if (liveNode?.awaitingInput) return { kind: 'ask' };
    if (picker === 'model') return { kind: 'model' };
    if (picker === 'conv') return { kind: 'conv' };
    if (picker === 'resume') return { kind: 'resume' };
    if (conversation.isCreating) {
      return { kind: 'busy', label: 'creating new conversation…' };
    }
    if (conversation.isConfigUpdating) {
      return { kind: 'busy', label: 'switching model…' };
    }
    if (activating) return { kind: 'busy', label: 'activating conversation…' };
    if (liveNode?.isThinking) return { kind: 'busy', label: 'thinking…' };
    return { kind: 'input' };
  })();

  const closePanel = () => setPicker(null);

  let bottomPanel: ReactNode;
  switch (mode.kind) {
    case 'ask':
      bottomPanel = <AskUserForm node={liveNode!} cols={cols} />;
      break;
    case 'model':
      bottomPanel = <ModelPicker onClose={closePanel} />;
      break;
    case 'conv':
      bottomPanel = <ConvPicker onClose={closePanel} />;
      break;
    case 'resume':
      bottomPanel = (
        <ResumePicker onPick={handleResumePick} onClose={closePanel} />
      );
      break;
    case 'busy':
      bottomPanel = <Spinner label={mode.label} />;
      break;
    case 'input':
      bottomPanel = (
        <>
          {notice !== '' && <Text fg="red">{notice}</Text>}
          <ChatInput
            convId={convId}
            streamingId={streamingId}
            onCommand={handleCommand}
            initialContent={prefill}
            onApplyInitial={() => setPrefill('')}
          />
        </>
      );
      break;
  }

  return (
    <>
      {/* key remounts Static on conv switch so the clear + remount re-emits fresh history */}
      <Static key={`${convId}:${remountKey}`} items={staticItems}>
        {m => (
          <Box key={m.id} flexDirection="column">
            {m.role === Role.ASSIST ? (
              <AssistantView
                node={chat.getMessageNode(convId, m.id)!}
                deferred
              />
            ) : (
              <UserView content={m.content} />
            )}
            <Text> </Text>
          </Box>
        )}
      </Static>
      {liveNode && <AssistantView node={liveNode} expanded={expanded} />}
      <HRule cols={cols} />
      {bottomPanel}
      <HRule cols={cols} />
      <Text> </Text>
      <StatusBar />
    </>
  );
});
