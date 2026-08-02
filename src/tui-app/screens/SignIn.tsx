/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { Input } from '@/tui/components/Input';
import { BorderedBox } from '@/tui/components/BorderedBox';
import { useKeyboard, useTerminalSize } from '@/tui/hooks';
import { useStore } from '@/client/store';

// Email/password sign-in; each Input owns its Enter via onSubmit (advance or
// submit), a global handler only switches fields. Form anchored to the bottom half.
export const SignIn = observer(function SignIn() {
  const auth = useStore('auth');
  const { rows } = useTerminalSize();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [field, setField] = useState<0 | 1>(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await auth.signInEmail({ email, password } as never);
      if (res.error) {
        setError(
          String(
            (res.error as { message?: string }).message ?? 'sign-in failed',
          ),
        );
        setBusy(false);
      }
      // success → auth store sets currentUser → Root swaps; busy stays true
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  }

  // Navigation only — Enter is owned by each Input's onSubmit. Input ignores
  // ↑/↓, so this never conflicts with typing.
  useKeyboard(data => {
    if (busy) return;
    if (data === '\x1b[A' || data === '\x1b[B') {
      setField(f => (f === 0 ? 1 : 0));
    }
  });

  const hint = busy
    ? 'signing in…'
    : field === 0
      ? 'Enter → password  ·  ↑↓ switch'
      : 'Enter → sign in  ·  ↑↓ switch';

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexGrow={1} />
      <Box flexDirection="column" alignItems="center" paddingBottom={1}>
        <Box flexDirection="column" width={48}>
          <Box height={1} marginBottom={1}>
            <Text fg="cyan" bold>
              langvis · sign in
            </Text>
          </Box>
          <BorderedBox title="credentials" fg="cyan">
            <Box height={1}>
              <Text fg="gray">{'email'}</Text>
            </Box>
            <Box height={1}>
              <Input
                value={email}
                onChange={setEmail}
                onSubmit={() => setField(1)}
                enabled={field === 0 && !busy}
              />
            </Box>
            <Box height={1} marginTop={1}>
              <Text fg="gray">{'password'}</Text>
            </Box>
            <Box height={1}>
              <Input
                value={password}
                onChange={setPassword}
                onSubmit={() => void submit()}
                mask
                enabled={field === 1 && !busy}
              />
            </Box>
            <Box height={1} marginTop={1}>
              {error ? (
                <Text fg="red">{error}</Text>
              ) : (
                <Text fg="gray">{hint}</Text>
              )}
            </Box>
          </BorderedBox>
        </Box>
      </Box>
    </Box>
  );
});
