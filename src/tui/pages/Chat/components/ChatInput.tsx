/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAsyncFn } from 'react-use';
import { Text } from '@/tui/components/Text';
import { useKeyboard } from '@/tui/hooks/useKeyboard';
import { useStore } from '@/client/store';
import { Role } from '@/shared/types/entities';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { SlashPicker } from './SlashPicker';
import { Textarea, type TextareaHandle } from './Textarea';
import { emptyBuffer, bufferText, type Buffer } from '../../../libs/editor';
import {
  historyStep,
  type HistoryDir,
  type HistoryState,
} from '../../../libs/history';
import {
  buildEntries,
  SLASH_COMMANDS,
  type SlashEntry,
} from '../../../libs/slash';

export const ChatInput = observer(function ChatInput({
  convId,
  streamingId,
  onCommand,
  initialContent = '',
  onApplyInitial,
}: {
  convId: string;
  streamingId: string | null;
  onCommand: (raw: string) => void;
  /** 重试预填：本组件挂载时把该文本写入输入区后回调（幂等，仅首次）。 */
  initialContent?: string;
  onApplyInitial?: () => void;
}) {
  const chat = useStore('chat');
  const agent = useStore('agent');
  const conversation = useStore('conversation');
  const [buf, setBuf] = useState<Buffer>(emptyBuffer());
  const [voiceErr, setVoiceErr] = useState('');
  const taRef = useRef<TextareaHandle>(null);
  // Readline history of this conversation's past user messages (oldest → newest).
  const history = useMemo(
    () =>
      (conversation.messages[convId] ?? [])
        .filter(m => m.role === Role.USER && m.content.trim() !== '')
        .map(m => m.content),
    [conversation.messages[convId]],
  );

  // History-nav position; a ref (never rendered) so rapid keypresses see fresh
  // state via the useKeyboard-ref handler. pos === history.length = the draft slot.
  const histRef = useRef<HistoryState>({ pos: history.length, draft: '' });

  function navHistory(dir: HistoryDir) {
    const { state, text } = historyStep(
      histRef.current,
      dir,
      history,
      bufferText(buf),
    );
    if (text === null) return;
    histRef.current = state;
    taRef.current?.replace(text);
  }

  // A new conversation (or a now-larger history after submit / async load) gets a
  // fresh nav position back at the draft slot; the typed draft is preserved.
  useEffect(() => {
    histRef.current = { pos: history.length, draft: '' };
  }, [convId, history.length]);

  // 重试预填：组件挂载后把 initialContent 写入输入区（仅首次），并通知父级已消费。
  const appliedInitialRef = useRef(false);
  useEffect(() => {
    if (!initialContent || appliedInitialRef.current) return;
    appliedInitialRef.current = true;
    taRef.current?.replace(initialContent);
    onApplyInitial?.();
  }, [initialContent, onApplyInitial]);

  const [skillState, fetchSkills] = useAsyncFn(() => agent.listSkills());
  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);
  const entries = useMemo(
    () => buildEntries(skillState.value ?? []),
    [skillState.value],
  );

  // Caret-ending `/query` — non-null while the caret sits in a slash token.
  const [query, setQuery] = useState<string | null>(null);

  const voice = useVoiceInput({
    // Mirror the web voice input: the transcript is wrapped in <speech> so the
    // sent content carries the speech marker the backend (gf skill) consumes.
    onTranscribed: text => {
      const wrapped = `<speech>\n${text}\n</speech>`;
      taRef.current?.insert(bufferText(buf) ? `\n${wrapped}` : wrapped);
    },
    onError: setVoiceErr,
  });

  // Ctrl-r toggles recording; Enter (below) stops + transcribes; Ctrl-c cancels.
  // (Streaming cancel now lives in Chat so it works off the input panel too.)
  useKeyboard(data => {
    if (data === '\x12' && !streamingId && !voice.processing) {
      // 0x12 = Ctrl-r
      if (voice.recording) void voice.stop();
      else voice.start();
    } else if (data === '\x03' && voice.recording) {
      voice.cancel();
    }
  });

  const paletteOpen = query !== null;

  function pick(entry: SlashEntry) {
    setQuery(null);
    // Fill the token only — the user hits Enter to run a config command or keeps
    // typing args for a skill; the trailing space stops the palette re-opening.
    taRef.current?.acceptQuery(
      `${entry.kind === 'skill' ? `/${entry.skill.id}` : `/${entry.cmd}`} `,
    );
  }

  return (
    <>
      {voice.recording && (
        <Text fg="yellow">
          ● recording… (Ctrl-r/Enter stop · Ctrl-c cancel)
        </Text>
      )}
      {voice.processing && <Text fg="cyan">◦ transcribing…</Text>}
      {voiceErr !== '' && <Text fg="red">{voiceErr}</Text>}
      {paletteOpen && (
        <SlashPicker
          query={query}
          entries={entries}
          isLoading={skillState.loading}
          onPick={pick}
          onClose={() => setQuery(null)}
        />
      )}
      <Textarea
        ref={taRef}
        buffer={buf}
        onBufferChange={setBuf}
        fg={streamingId ? 'gray' : 'white'}
        prompt={streamingId ? '… ' : '> '}
        navLocked={paletteOpen}
        onSlashQuery={setQuery}
        onHistory={navHistory}
        onSubmit={real => {
          if (voice.recording) {
            // Enter during recording stops + transcribes instead of sending.
            void voice.stop();
            return;
          }
          const trimmed = real.trim();
          if (!trimmed) return;
          // Only config commands are handled locally; a `/skill …` message is
          // sent as normal content (the backend retrieves the skill by query).
          const first = trimmed.split(/\s+/)[0].toLowerCase();
          if (SLASH_COMMANDS.some(c => c.token === first)) onCommand(first);
          else {
            void chat.startChat({
              conversationId: convId,
              role: Role.USER,
              content: real,
            });
          }
          setBuf(emptyBuffer());
          // Back to the draft slot for any submit (config commands don't grow the
          // reactive history, so the length effect above won't fire for them).
          histRef.current = { pos: history.length, draft: '' };
        }}
      />
    </>
  );
});
