/** @jsxImportSource react */
import { useState } from 'react';
import { Text } from '@/tui/components/Text';
import { useKeyboard } from '@/tui/hooks';

export type Option = { label: string; value: string | number | boolean };

type ControlProps = {
  value: unknown;
  onChange: (value: unknown) => void;
  focused: boolean;
};

const ARROW_LEFT = '\x1b[D';
const ARROW_RIGHT = '\x1b[C';

/** ◀▶ toggles a boolean value. */
export function BooleanControl({ value, onChange, focused }: ControlProps) {
  useKeyboard(data => {
    if (data === ARROW_LEFT || data === ARROW_RIGHT) onChange(!value);
  }, focused);
  return (
    <Text fg={focused ? 'cyan' : 'white'}>{value ? '● yes' : '○ no'}</Text>
  );
}

/** ◀▶ cycles through a single-choice option list. */
export function EnumControl({
  options,
  value,
  onChange,
  focused,
}: ControlProps & { options?: Option[] }) {
  useKeyboard(data => {
    const opts = options ?? [];
    if (!opts.length) return;
    if (data === ARROW_LEFT || data === ARROW_RIGHT) {
      const from = Math.max(
        0,
        opts.findIndex(o => o.value === value),
      );
      const dir = data === ARROW_RIGHT ? 1 : -1;
      const next = (from + dir + opts.length) % opts.length;
      onChange(opts[next]?.value);
    }
  }, focused);
  const cur = options?.find(o => o.value === value);
  return (
    <Text fg={focused ? 'cyan' : 'white'}>{`${cur?.label ?? '?'} ◀▶`}</Text>
  );
}

/** ◀▶ moves the cursor, ␣ toggles the option under it; cursor only shows when focused. */
export function MultiSelectControl({
  options,
  value,
  onChange,
  focused,
}: ControlProps & { options?: Option[] }) {
  const [cursor, setCursor] = useState(0);
  const opts = options ?? [];

  useKeyboard(data => {
    if (!opts.length) return;
    if (data === ARROW_LEFT || data === ARROW_RIGHT) {
      setCursor(
        c => (c + (data === ARROW_RIGHT ? 1 : -1) + opts.length) % opts.length,
      );
      return;
    }
    if (data === ' ') {
      const sel = opts[cursor % opts.length]?.value;
      if (sel == null) return;
      const arr = Array.isArray(value) ? [...(value as unknown[])] : [];
      const at = arr.findIndex(x => x === sel);
      if (at >= 0) arr.splice(at, 1);
      else arr.push(sel);
      onChange(arr);
    }
  }, focused);

  const arr = Array.isArray(value) ? (value as unknown[]) : [];
  const ci = focused && opts.length ? cursor % opts.length : -1;
  return (
    <>
      {opts.map((o, i) => {
        const selected = arr.includes(o.value);
        const isCur = i === ci;
        return (
          <Text key={i} fg={isCur ? 'cyan' : selected ? 'white' : 'gray'}>
            {`${selected ? '●' : '○'}${o.label} `}
          </Text>
        );
      })}
      {focused && <Text fg="gray">{'◀▶␣'}</Text>}
    </>
  );
}
