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

/** A user turn — avatar `❯` inline with the content (content column to its
 * right), rendered from raw message content. */
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

/** An assistant turn — observable MessageNode. Avatar `✦` inline with the body
 * (flashes while thinking). Body = thinking dots / tool blocks / markdown
 * content / awaiting-input / status. Re-renders on each streamed token. */
export const AssistantView = observer(function AssistantView({
  node,
}: {
  node: MessageNode;
}) {
  const { cols } = useTerminalSize();
  const w = Math.max(1, cols - AVATAR_GAP);
  const thinking = node.isThinking;
  const diamond = useFrameSequence(thinking, ['◆', '◇'], 450);
  const dots = useFrameSequence(thinking, ['', '.', '..', '...'], 350);
  return (
    <Box alignItems="flex-start">
      <Text fg="magenta" bold>{`${thinking ? diamond : '◆'}  `}</Text>
      <Box flexDirection="column" width={w}>
        {thinking && <Text fg="gray">{`thinking${dots}`}</Text>}
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
          return call ? (
            <ToolCallView
              key={item.key}
              call={call}
              paused={node.isAwaitingInput}
            />
          ) : null;
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
