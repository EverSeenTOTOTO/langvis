/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { Spinner } from '@inkjs/ui';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { truncate } from '@/tui/width';
import { useTerminalSize } from '@/tui/hooks';
import {
  aggregateSubagentChildren,
  lastStreamLine,
  type UIToolCall,
} from '@/client/store/modules/message-node';

const AVATAR_GAP = 3;
const TOOL_COLORS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];

function toolColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return TOOL_COLORS[Math.abs(h) % TOOL_COLORS.length];
}

function duration(call: UIToolCall): string {
  if (call.startedAt == null || call.completedAt == null) return '';
  return `${(Math.max(0, call.completedAt - call.startedAt) / 1000).toFixed(1)}s`;
}

/** Compact one-line JSON of a tool's args (empty string when none). Per-tool
 * display niceties live in dedicated components (see ToolCallView dispatch),
 * not here — mirrors the antd client, which JSON-dumps args and specializes
 * via separate components / a customRender hook. */
function formatArgs(args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return '';
  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}

function formatOutput(output: unknown): string {
  if (output == null || output === '') return '';
  if (typeof output === 'string') return output.replace(/\n+/g, ' ').trim();
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

const Glyph = observer(function Glyph({
  call,
  paused,
}: {
  call: UIToolCall;
  paused: boolean;
}) {
  if (call.status !== 'pending') {
    return (
      <Text fg={call.status === 'completed' ? 'green' : 'red'}>
        {call.status === 'completed' ? '✓' : '✗'}
      </Text>
    );
  }
  if (paused) return <Text fg="yellow">{'?'}</Text>;
  return <Spinner />;
});

/** Generic tool call: status glyph + color-hashed name + arg hint + duration,
 * then the latest progress line (while pending), completed output, or error. */
export const ToolBlock = observer(function ToolBlock({
  call,
  paused = false,
}: {
  call: UIToolCall;
  paused?: boolean;
}) {
  const { cols } = useTerminalSize();
  const w = Math.max(20, cols - AVATAR_GAP);
  const pending = call.status === 'pending';
  const argHint = formatArgs(call.toolArgs);
  const prog = pending ? lastStreamLine(call.progress) : '';
  const out = !pending ? formatOutput(call.output) : '';
  const dur = duration(call);

  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Glyph call={call} paused={paused} />
        <Text fg={toolColor(call.toolName)}>{` ${call.toolName}`}</Text>
        {argHint !== '' && (
          <Text fg="gray">{` ${truncate(argHint, Math.floor(w / 2))}`}</Text>
        )}
        {dur !== '' && <Text fg="gray">{` ${dur}`}</Text>}
      </Box>
      {prog !== '' && <Text fg="gray">{`  ${truncate(prog, w - 2)}`}</Text>}
      {out !== '' && <Text fg="gray">{`  ↳ ${truncate(out, w - 4)}`}</Text>}
      {call.error && <Text fg="red">{`  ${truncate(call.error, w - 2)}`}</Text>}
    </Box>
  );
});

/** skill_call: skillId + status + duration. */
export const SkillBlock = observer(function SkillBlock({
  call,
  paused = false,
}: {
  call: UIToolCall;
  paused?: boolean;
}) {
  const skillId = String(call.toolArgs.skillId ?? call.toolArgs.id ?? '');
  const dur = duration(call);
  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Glyph call={call} paused={paused} />
        <Text fg="magenta">{' skill'}</Text>
        {skillId !== '' && <Text fg="white">{` ${skillId}`}</Text>}
        {dur !== '' && <Text fg="gray">{` ${dur}`}</Text>}
      </Box>
      {call.error && <Text fg="red">{`  ${call.error}`}</Text>}
    </Box>
  );
});

/** call_subagents: header with child count, then a line per child run —
 * status glyph + query + brief. Child runs are read from the progress stream. */
export const SubagentsBlock = observer(function SubagentsBlock({
  call,
  paused = false,
}: {
  call: UIToolCall;
  paused?: boolean;
}) {
  const { cols } = useTerminalSize();
  const w = Math.max(20, cols - AVATAR_GAP);
  const children = aggregateSubagentChildren(call.progress);
  const dur = duration(call);

  const glyph = (s: string) =>
    s === 'failed'
      ? '✗'
      : s === 'cancelled'
        ? '○'
        : s === 'completed'
          ? '✓'
          : '…';
  const fg = (s: string) =>
    s === 'failed' ? 'red' : s === 'completed' ? 'green' : 'yellow';

  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Glyph call={call} paused={paused} />
        <Text fg={toolColor(call.toolName)}>{` ${call.toolName}`}</Text>
        <Text fg="gray">{` · ${children.length} sub-agent${children.length === 1 ? '' : 's'}${dur !== '' ? ` · ${dur}` : ''}`}</Text>
      </Box>
      {children.map((c, i) => {
        const q = truncate(c.query ?? '', Math.floor(w / 2));
        return (
          <Box key={c.runId ?? i} height={1}>
            <Text fg={fg(c.status)}>{`  ${glyph(c.status)} `}</Text>
            <Text fg="white">{q}</Text>
            {c.brief && (
              <Text fg="gray">{` — ${truncate(c.brief, Math.floor(w / 2))}`}</Text>
            )}
          </Box>
        );
      })}
      {call.error && <Text fg="red">{`  ${call.error}`}</Text>}
    </Box>
  );
});

/** Dispatch a tool call to the right renderer by tool name. */
export const ToolCallView = observer(function ToolCallView({
  call,
  paused = false,
}: {
  call: UIToolCall;
  paused?: boolean;
}) {
  if (call.toolName === 'skill_call') {
    return <SkillBlock call={call} paused={paused} />;
  }
  if (call.toolName === 'call_subagents') {
    return <SubagentsBlock call={call} paused={paused} />;
  }
  return <ToolBlock call={call} paused={paused} />;
});
