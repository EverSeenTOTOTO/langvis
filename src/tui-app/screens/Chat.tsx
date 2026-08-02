/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { Input } from '@/tui/components/Input';
import { Static } from '@/tui/components/Static';
import { Progress } from '@/tui/components/Progress';
import { useKeyboard, useTerminalSize } from '@/tui/hooks';
import { useStore } from '@/client/store';
import { Role, type Message } from '@/shared/types/entities';
import { AssistantView, UserView } from '../components/MessageView';
import { AskUserForm } from '../components/AskUserForm';

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

const StatusBar = observer(function StatusBar({
  status,
}: {
  status: 'idle' | 'activating' | 'streaming';
}) {
  const conversation = useStore('conversation');
  const usage = conversation.conversationUsage;
  const model =
    (
      conversation.currentConversation?.config as {
        model?: { modelId?: string };
      } | null
    )?.model?.modelId ?? '?';
  return (
    <Box height={1}>
      <Text fg="cyan">langvis</Text>
      <Text fg="gray">{` · ${model} · ctx `}</Text>
      {usage ? (
        <Progress value={usage.used} max={usage.total} width={16} />
      ) : (
        <Text fg="gray">—</Text>
      )}
      <Text fg={status === 'idle' ? 'gray' : 'yellow'}>{` · ${status}`}</Text>
      <Text fg="gray">{` · ${conversation.currentConversation?.name || conversation.currentConversationId}`}</Text>
    </Box>
  );
});

const ChatInput = observer(function ChatInput({
  convId,
  streamingId,
}: {
  convId: string;
  streamingId: string | null;
}) {
  const chat = useStore('chat');
  const [v, setV] = useState('');

  useKeyboard(data => {
    if ((data === '\x1b' || data === '\x03') && streamingId) {
      void chat.cancelChat({ conversationId: convId, messageId: streamingId });
    }
  });

  return (
    <Box height={1}>
      <Text fg="green">{streamingId ? '… ' : '> '}</Text>
      <Input
        value={v}
        onChange={setV}
        fg={streamingId ? 'gray' : 'white'}
        onSubmit={s => {
          if (s.trim()) {
            void chat.startChat({
              conversationId: convId,
              role: Role.USER,
              content: s,
            });
            setV('');
          }
        }}
      />
    </Box>
  );
});

export const Chat = observer(function Chat() {
  const conversation = useStore('conversation');
  const chat = useStore('chat');
  const { cols } = useTerminalSize();
  const convId = conversation.currentConversationId;

  if (!convId) return null;

  const all = (conversation.messages[convId] ?? []).filter(isVisible);

  // The streaming node = the last assistant message whose run isn't terminal.
  let streamingId: string | null = null;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].role !== Role.ASSIST) continue;
    const node = chat.getMessageNode(convId, all[i].id);
    if (node && !node.isTerminal) streamingId = all[i].id;
    break;
  }

  const committed = streamingId ? all.filter(m => m.id !== streamingId) : all;
  const streamingNode = streamingId
    ? chat.getMessageNode(convId, streamingId)
    : null;

  // `currentSessionActive` covers both connecting (activation/replay) and a
  // running turn; `streamingId` disambiguates — no node yet means activating.
  const activating = chat.currentSessionActive && !streamingId;
  const status: 'idle' | 'activating' | 'streaming' = streamingId
    ? 'streaming'
    : activating
      ? 'activating'
      : 'idle';

  // While awaiting user input, paint as a full frame (absolute positioning +
  // clear, like the sign-in screen) instead of the streaming live region. The
  // streaming erase is a *relative* cursor-up that desyncs once the tall panel
  // scrolls the terminal, stacking duplicate panels. Full-frame shows recent
  // messages (context) on top and pins the panel at the bottom via a spacer.
  if (streamingNode?.awaitingInput) {
    return (
      <>
        {committed.slice(-3).map(m => (
          <Box key={m.id} flexDirection="column">
            {m.role === Role.ASSIST ? (
              <AssistantView node={chat.getMessageNode(convId, m.id)!} />
            ) : (
              <UserView content={m.content} />
            )}
            <Text> </Text>
          </Box>
        ))}
        <AssistantView node={streamingNode} />
        <Box flexGrow={1}>
          <Text> </Text>
        </Box>
        <HRule cols={cols} />
        <AskUserForm node={streamingNode} cols={cols} />
        <HRule cols={cols} />
        <StatusBar status={status} />
      </>
    );
  }

  return (
    <>
      <Static items={committed}>
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
      {streamingNode && <AssistantView node={streamingNode} />}
      <HRule cols={cols} />
      {streamingNode?.awaitingInput ? (
        <AskUserForm node={streamingNode} cols={cols} />
      ) : (
        <ChatInput convId={convId} streamingId={streamingId} />
      )}
      <HRule cols={cols} />
      <Text> </Text>
      <StatusBar status={status} />
    </>
  );
});
