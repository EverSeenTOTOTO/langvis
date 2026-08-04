/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { useKeyboard } from '@/tui/hooks';
import {
  entryDesc,
  entryToken,
  filterEntries,
  type SlashEntry,
} from '../slash';

// `/` command palette. Nav is Up/Down; Enter or Tab completes the highlighted
// entry; cancel is Esc only (a `q` keystroke stays free for the query text).
export function SlashPicker({
  query,
  entries,
  isLoading = false,
  onPick,
  onClose,
}: {
  query: string;
  entries: SlashEntry[];
  isLoading?: boolean;
  onPick: (e: SlashEntry) => void;
  onClose: () => void;
}) {
  const filtered = filterEntries(entries, query);
  const [sel, setSel] = useState(0);

  // Reset the highlight when the query changes (mirrors the web picker).
  useEffect(() => {
    setSel(0);
  }, [query]);

  useKeyboard(data => {
    if (data === '\x1b') {
      onClose();
      return;
    }
    if (data === '\x1b[B' || data === '\x0e') {
      setSel(s => (filtered.length ? (s + 1) % filtered.length : 0));
    } else if (data === '\x1b[A' || data === '\x10') {
      setSel(s =>
        filtered.length ? (s - 1 + filtered.length) % filtered.length : 0,
      );
    } else if (data === '\r' || data === '\x1b[13;5u' || data === '\t') {
      const picked = filtered[sel];
      if (picked) onPick(picked);
    }
  });

  return (
    <Box flexDirection="column">
      {filtered.map((e, i) => {
        const isSel = i === sel;
        return (
          <Box key={entryToken(e)} height={1}>
            <Text fg={isSel ? 'cyan' : 'gray'}>{isSel ? '› ' : '  '}</Text>
            <Text fg={isSel ? 'gray' : 'white'} bold={isSel}>
              {entryToken(e)}
            </Text>
            <Text fg="gray">{`  ${entryDesc(e)}`}</Text>
          </Box>
        );
      })}
      {filtered.length === 0 && (
        <Text fg="gray">
          {isLoading ? 'loading skills…' : 'no matching commands'}
        </Text>
      )}
      <Text fg="gray">{'↑↓ move · Enter/Tab pick · Esc cancel'}</Text>
    </Box>
  );
}
