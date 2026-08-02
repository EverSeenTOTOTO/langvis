/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import type { MessageNode } from '@/client/store/modules/message-node';
import { Paragraph } from './Paragraph';
import { Markdown } from '@/tui/components/Markdown';
import { ToolCallView } from './ToolBlock';
import { useFrameSequence, useTerminalSize } from '@/tui/hooks';

/** Avatar glyph + spaces; the body column is `cols - AVATAR_GAP` wide. */
const AVATAR_GAP = 3;

// A user turn — avatar `❯` inline with the content column, from raw message content.
export function UserView({ content }: { content: string }) {
  const { cols } = useTerminalSize();
  const w = Math.max(1, cols - AVATAR_GAP);
  return (
    <Box alignItems="flex-start">
      <Text fg="cyan" bold>
        {'◆  '}
      </Text>
      <Box flexDirection="column" width={w}>
        {content !== '' && <Paragraph text={content} fg="white" width={w} />}
      </Box>
    </Box>
  );
}

// An assistant turn — observable MessageNode. Avatar `◆` inline (flashes while
// thinking); body = thought/tool cards / markdown / status; re-renders on stream.
export const AssistantView = observer(function AssistantView({
  node,
  expanded = false,
}: {
  node: MessageNode;
  expanded?: boolean;
}) {
  const { cols } = useTerminalSize();
  const w = Math.max(1, cols - AVATAR_GAP);
  const diamond = useFrameSequence(node.isThinking, ['◆', '◇'], 450);
  return (
    <Box alignItems="flex-start">
      <Text fg="magenta" bold>{`${diamond}  `}</Text>
      <Box flexDirection="column" width={w}>
        {node.timeline.map(item => {
          if (item.kind === 'thought') {
            return (
              <Paragraph
                key={item.key}
                text={item.content}
                fg="gray"
                width={w}
              />
            );
          }
          const call = node.toolCalls.find(tc => tc.callId === item.callId);
          // response_user is the agent's final reply — rendered as content, so
          // don't show it as a tool block.
          if (!call || call.toolName === 'response_user') return null;
          return (
            <ToolCallView
              key={item.key}
              call={call}
              paused={node.isAwaitingInput || node.isTerminal}
              expanded={expanded}
            />
          );
        })}
        {node.hasContent && <Markdown text={node.content} width={w} />}
        {node.status === 'failed' && <Text fg="red">{'✗ run failed'}</Text>}
        {node.status === 'cancelled' && (
          <Text fg="yellow">{'○ cancelled'}</Text>
        )}
      </Box>
    </Box>
  );
});
