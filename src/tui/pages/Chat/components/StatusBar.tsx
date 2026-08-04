/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { basename } from 'node:path';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { Progress } from '@/tui/components/Progress';
import { useStore } from '@/client/store';

// Compact token count: 1234 → "1.2K", 1234567 → "1.2M" (mirrors web ContextUsageBar).
const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
};

export const StatusBar = observer(function StatusBar() {
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
