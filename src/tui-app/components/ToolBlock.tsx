/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { Spinner } from '@/tui/components/Spinner';
import { truncate } from '../wrap';
import { useTerminalSize } from '@/tui/hooks';
import {
  aggregateSubagentChildren,
  lastStreamLine,
  type UIToolCall,
} from '@/client/store/modules/message-node';

const AVATAR_GAP = 3;
// card content width: terminal minus avatar gap, two border columns, and padding.
const useCardWidth = (): number => {
  const { cols } = useTerminalSize();
  return Math.max(10, cols - AVATAR_GAP - 4);
};

// Borders distinguish KIND, not tool identity: all tools share one border
// color; only the tool name (header) gets a hash color. Mirrors the web.
const BORDER_TOOL = 'gray';
const BORDER_SKILL = 'magenta';

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

/** Args JSON — compact one-line when collapsed, pretty (indent 2) when expanded. */
function formatArgs(args: Record<string, unknown>, expanded: boolean): string {
  if (!args || Object.keys(args).length === 0) return '';
  try {
    return JSON.stringify(args, null, expanded ? 2 : 0);
  } catch {
    return '';
  }
}

// Output — collapsed single line; expanded full, capped to 30 lines.
function formatOutput(output: unknown, expanded: boolean): string {
  if (output == null || output === '') return '';
  if (typeof output === 'string') {
    if (!expanded) return output.replace(/\n+/g, ' ').trim();
    return output.replace(/\n+$/, '').split('\n').slice(0, 30).join('\n');
  }
  try {
    return JSON.stringify(output, null, expanded ? 2 : 0);
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

function CardHeader({
  call,
  paused,
  name,
  color,
  suffix,
}: {
  call: UIToolCall;
  paused: boolean;
  name: string;
  color: string;
  suffix?: string;
}) {
  const dur = duration(call);
  return (
    <Box>
      <Glyph call={call} paused={paused} />
      <Text fg={color} bold>{` ${name}`}</Text>
      {suffix ? <Text fg="gray">{suffix}</Text> : null}
      {dur !== '' ? <Text fg="gray">{`  ${dur}`}</Text> : null}
    </Box>
  );
}

// Tool call card: header + args / progress / result / error; `expanded` shows full pretty args.
export const ToolBlock = observer(function ToolBlock({
  call,
  paused = false,
  expanded = false,
}: {
  call: UIToolCall;
  paused?: boolean;
  expanded?: boolean;
}) {
  const inner = useCardWidth();
  const color = toolColor(call.toolName);
  const pending = call.status === 'pending';
  const argHint = formatArgs(call.toolArgs, expanded);
  const prog = pending ? lastStreamLine(call.progress) : '';
  const out = !pending ? formatOutput(call.output, expanded) : '';

  return (
    <Box
      flexDirection="column"
      width="100%"
      borderStyle="single"
      borderColor={BORDER_TOOL}
      paddingLeft={1}
      paddingRight={1}
    >
      <CardHeader
        call={call}
        paused={paused}
        name={call.toolName}
        color={color}
      />
      {argHint !== '' ? (
        <>
          <Text> </Text>
          <Text fg="gray">{expanded ? argHint : truncate(argHint, inner)}</Text>
        </>
      ) : null}
      {prog !== '' ? (
        <>
          <Text> </Text>
          <Text fg="gray">{expanded ? prog : truncate(prog, inner)}</Text>
        </>
      ) : null}
      {out !== '' ? (
        <>
          <Text> </Text>
          <Text>
            <Text fg="cyan" bold>
              {'↳ '}
            </Text>
            <Text fg="gray">{expanded ? out : truncate(out, inner - 2)}</Text>
          </Text>
        </>
      ) : null}
      {call.error ? (
        <>
          <Text> </Text>
          <Text fg="red">
            {expanded ? call.error : truncate(call.error, inner)}
          </Text>
        </>
      ) : null}
    </Box>
  );
});

/** skill_call: a magenta-bordered card with the skillId prominent. */
export const SkillBlock = observer(function SkillBlock({
  call,
  paused = false,
}: {
  call: UIToolCall;
  paused?: boolean;
}) {
  const inner = useCardWidth();
  const skillId = String(call.toolArgs.skillId ?? call.toolArgs.id ?? '');
  return (
    <Box
      flexDirection="column"
      width="100%"
      borderStyle="single"
      borderColor={BORDER_SKILL}
      paddingLeft={1}
      paddingRight={1}
    >
      <CardHeader
        call={call}
        paused={paused}
        name={`skill ${skillId}`}
        color={BORDER_SKILL}
      />
      {call.error ? <Text fg="red">{truncate(call.error, inner)}</Text> : null}
    </Box>
  );
});

// call_subagents card: sub-agent count header + one row per child run; `expanded` shows full text.
export const SubagentsBlock = observer(function SubagentsBlock({
  call,
  paused = false,
  expanded = false,
}: {
  call: UIToolCall;
  paused?: boolean;
  expanded?: boolean;
}) {
  const inner = useCardWidth();
  const color = toolColor(call.toolName);
  const children = aggregateSubagentChildren(call.progress);
  const suffix = ` · ${children.length} sub-agent${children.length === 1 ? '' : 's'}`;
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
    <Box
      flexDirection="column"
      width="100%"
      borderStyle="single"
      borderColor={BORDER_TOOL}
      paddingLeft={1}
      paddingRight={1}
    >
      <CardHeader
        call={call}
        paused={paused}
        name={call.toolName}
        color={color}
        suffix={suffix}
      />
      {children.length > 0 ? <Text> </Text> : null}
      {children.map((c, i) => {
        const q = expanded
          ? (c.query ?? '')
          : truncate(c.query ?? '', inner - 2);
        return (
          <Box key={c.runId ?? i} flexDirection="column">
            <Text>
              <Text fg={fg(c.status)}>{`${glyph(c.status)} `}</Text>
              <Text fg="white">{q}</Text>
            </Text>
            {c.brief ? (
              <Text fg="gray">{`  ${expanded ? c.brief : truncate(c.brief, inner - 2)}`}</Text>
            ) : null}
          </Box>
        );
      })}
      {call.error ? <Text fg="red">{truncate(call.error, inner)}</Text> : null}
    </Box>
  );
});

/** Dispatch a tool call to the right card by tool name. */
export const ToolCallView = observer(function ToolCallView({
  call,
  paused = false,
  expanded = false,
}: {
  call: UIToolCall;
  paused?: boolean;
  expanded?: boolean;
}) {
  if (call.toolName === 'skill_call') {
    return <SkillBlock call={call} paused={paused} />;
  }
  if (call.toolName === 'call_subagents') {
    return <SubagentsBlock call={call} paused={paused} expanded={expanded} />;
  }
  return <ToolBlock call={call} paused={paused} expanded={expanded} />;
});
