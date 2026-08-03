/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { basename } from 'node:path';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useVoiceInput } from '../useVoiceInput';
import { Spinner } from '@/tui/components/Spinner';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { Static } from '@/tui/components/Static';
import { Progress } from '@/tui/components/Progress';
import { useKeyboard, useTerminalSize } from '@/tui/hooks';
import { useStore } from '@/client/store';
import { Role, type Message } from '@/shared/types/entities';
import { AssistantView, UserView } from '../components/MessageView';
import { AskUserForm } from '../components/AskUserForm';
import { ModelPicker } from '../components/ModelPicker';
import { ConvPicker } from '../components/ConvPicker';
import { Textarea, type TextareaHandle } from '../components/Textarea';
import { emptyBuffer, bufferText, type Buffer } from '../editor';

// Bottom panel is in exactly one of these modes at a time. `busy` covers every
// non-functional state (input disabled); sources live in their natural layers.
type BottomMode =
  | { kind: 'ask' }
  | { kind: 'model' }
  | { kind: 'conv' }
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

// Compact token count: 1234 → "1.2K", 1234567 → "1.2M" (mirrors web ContextUsageBar).
const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
};

const StatusBar = observer(function StatusBar() {
  const conversation = useStore('conversation');
  const usage = conversation.conversationUsage;
  const model =
    (
      conversation.currentConversation?.config as {
        model?: { modelId?: string };
      } | null
    )?.model?.modelId ?? '?';
  const name =
    conversation.currentConversation?.name ||
    conversation.currentConversationId ||
    '';
  const pct = usage ? Math.min((usage.used / usage.total) * 100, 100) : 0;
  // Leftmost slot shows the workspace dir (last segment of cwd) instead of the brand.
  const workspace = basename(process.cwd());
  return (
    <Box height={1}>
      <Text fg="cyan" bold>
        {workspace}
      </Text>
      <Text fg="gray">{' · '}</Text>
      <Text fg="magenta">{model}</Text>
      <Text fg="gray">{' · ctx '}</Text>
      {usage ? (
        <>
          <Progress
            value={usage.used}
            max={usage.total}
            width={12}
            showPct={false}
          />
          <Text fg="gray">{` ${formatTokens(usage.used)}/${formatTokens(usage.total)} (${pct.toFixed(1)}%)`}</Text>
        </>
      ) : (
        <Text fg="gray">—</Text>
      )}
      <Text fg="gray">{' · '}</Text>
      <Text fg="yellow" bold>
        {name}
      </Text>
    </Box>
  );
});

const ChatInput = observer(function ChatInput({
  convId,
  streamingId,
  onCommand,
}: {
  convId: string;
  streamingId: string | null;
  onCommand: (raw: string) => void;
}) {
  const chat = useStore('chat');
  const [buf, setBuf] = useState<Buffer>(emptyBuffer());
  const [voiceErr, setVoiceErr] = useState('');
  const taRef = useRef<TextareaHandle>(null);
  const voice = useVoiceInput({
    // Mirror the web voice input: the transcript is wrapped in <speech> so the
    // sent content carries the speech marker the backend (gf skill) consumes.
    onTranscribed: text => {
      const wrapped = `<speech>\n${text}\n</speech>`;
      taRef.current?.insert(bufferText(buf) ? `\n${wrapped}` : wrapped);
    },
    onError: setVoiceErr,
  });

  useKeyboard(data => {
    if ((data === '\x1b' || data === '\x03') && streamingId) {
      void chat.cancelChat({ conversationId: convId, messageId: streamingId });
    }
  });

  // Ctrl-r toggles recording; Enter (below) stops + transcribes; Ctrl-c cancels.
  useKeyboard(data => {
    if (data === '\x12' && !streamingId && !voice.processing) {
      // 0x12 = Ctrl-r
      if (voice.recording) void voice.stop();
      else voice.start();
    } else if (data === '\x03' && voice.recording) {
      voice.cancel();
    }
  });

  return (
    <>
      {voice.recording && (
        <Text fg="yellow">
          ● recording… (Ctrl-r/Enter stop · Ctrl-c cancel)
        </Text>
      )}
      {voice.processing && <Text fg="cyan">◦ transcribing…</Text>}
      {voiceErr !== '' && <Text fg="red">{voiceErr}</Text>}
      <Textarea
        ref={taRef}
        buffer={buf}
        onBufferChange={setBuf}
        fg={streamingId ? 'gray' : 'white'}
        prompt={streamingId ? '… ' : '> '}
        onSubmit={real => {
          if (voice.recording) {
            // Enter during recording stops + transcribes instead of sending.
            void voice.stop();
            return;
          }
          const trimmed = real.trim();
          if (!trimmed) return;
          if (trimmed.startsWith('/')) onCommand(real);
          else {
            void chat.startChat({
              conversationId: convId,
              role: Role.USER,
              content: real,
            });
          }
          setBuf(emptyBuffer());
        }}
      />
    </>
  );
});

export const Chat = observer(function Chat() {
  const conversation = useStore('conversation');
  const chat = useStore('chat');
  const model = useStore('model');
  const auth = useStore('auth');
  const { cols } = useTerminalSize();
  const convId = conversation.currentConversationId;
  const [picker, setPicker] = useState<null | 'model' | 'conv'>(null);
  const [notice, setNotice] = useState('');
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

  function handleCommand(raw: string) {
    const cmd = raw.trim().toLowerCase();
    setNotice('');
    if (cmd === '/model') setPicker('model');
    else if (cmd === '/conv') setPicker('conv');
    else if (cmd === '/new') void createNew();
    else if (cmd === '/logout') {
      // Clear local state first (lands on SignIn even if the server call fails),
      // then best-effort invalidate the remote session; cli.tsx drops the cookie.
      auth.logoutLocal();
      void auth.signOut({}).catch(() => {});
    } else if (cmd === '/' || cmd === '/help') {
      setNotice('commands: /model  /conv  /new  /logout');
    } else {
      setNotice(`unknown command: ${raw.trim()}`);
    }
  }

  // Ctrl+O toggles full tool detail for the current (streaming) turn.
  useKeyboard(data => {
    if (data === '\x0f') setExpanded(v => !v);
  });

  if (!convId) return null;

  const all = (conversation.messages[convId] ?? []).filter(isVisible);

  // The streaming turn = the last assistant message still in flight; only the
  // final entry qualifies so a stale previous node is never latched onto.
  let streamingId: string | null = null;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].role !== Role.ASSIST) continue;
    const node = chat.getMessageNode(convId, all[i].id);
    if (node && !node.isTerminal && i === all.length - 1) {
      streamingId = all[i].id;
    }
    break;
  }

  const committed = streamingId ? all.filter(m => m.id !== streamingId) : all;
  const streamingNode = streamingId
    ? chat.getMessageNode(convId, streamingId)
    : null;
  const activating = chat.isTransportConnecting && !streamingId;

  // Only the in-flight turn is live (not Static); committed turns go to Static so
  // the dynamic region stays under the viewport and Ink 7 never full-clears.
  const staticItems = committed;
  const liveNode = streamingNode;

  // Bottom-panel mode — one discriminated value, priority ask > picker > busy
  // > input; busy sources read from their own layers and merged only here.
  const mode: BottomMode = (() => {
    if (liveNode?.awaitingInput) return { kind: 'ask' };
    if (picker === 'model') return { kind: 'model' };
    if (picker === 'conv') return { kind: 'conv' };
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
              <AssistantView node={chat.getMessageNode(convId, m.id)!} />
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
