/** @jsxImportSource react */
import { useState } from 'react';
import { Text } from '@/tui/components/Text';
import { useKeyboard } from '@/tui/hooks/useKeyboard';
import { isKey } from '@/tui/libs/keys';

export type Option = { label: string; value: string | number | boolean };

type ControlProps = {
  value: unknown;
  onChange: (value: unknown) => void;
  focused: boolean;
};

/** ◀▶ toggles a boolean value. */
export function BooleanControl({ value, onChange, focused }: ControlProps) {
  useKeyboard(data => {
    if (isKey(data, 'left') || isKey(data, 'right')) onChange(!value);
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
    if (isKey(data, 'left') || isKey(data, 'right')) {
      const from = Math.max(
        0,
        opts.findIndex(o => o.value === value),
      );
      const dir = isKey(data, 'right') ? 1 : -1;
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
    if (isKey(data, 'left') || isKey(data, 'right')) {
      setCursor(
        c => (c + (isKey(data, 'right') ? 1 : -1) + opts.length) % opts.length,
      );
      return;
    }
    if (isKey(data, 'space')) {
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
