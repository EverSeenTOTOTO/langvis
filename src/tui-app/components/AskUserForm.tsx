/** @jsxImportSource react */
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { Box } from '@/tui/components/Box';
import { Text } from '@/tui/components/Text';
import { Input } from '@/tui/components/Input';
import { BorderedBox } from '@/tui/components/BorderedBox';
import { Markdown } from '@/tui/components/Markdown';
import { useKeyboard } from '@/tui/hooks';
import { useStore } from '@/client/store';
import type { MessageNode } from '@/client/store/modules/message-node';

type EnumItem =
  | string
  | number
  | { label: string; value: string | number | boolean };

type SchemaProp = {
  type?: string;
  title?: string;
  description?: string;
  enum?: EnumItem[];
  items?: { type?: string; enum?: EnumItem[] };
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  properties?: Record<string, SchemaProp>;
  required?: string[];
};
type Schema = SchemaProp;

type FieldKind = 'text' | 'number' | 'boolean' | 'enum' | 'multiselect';
type Field = {
  path: string[];
  pathKey: string;
  depth: number;
  label: string;
  description?: string;
  kind: FieldKind;
  options?: { label: string; value: string | number | boolean }[];
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
};
type Row =
  | { kind: 'group'; key: string; depth: number; title: string }
  | { kind: 'field'; field: Field };

function normalizeEnum(
  items?: EnumItem[],
): { label: string; value: string | number | boolean }[] | undefined {
  if (!items) return undefined;
  return items.map(item => {
    if (
      typeof item === 'object' &&
      item !== null &&
      'label' in item &&
      'value' in item
    ) {
      return { label: item.label, value: item.value };
    }
    return { label: String(item), value: item };
  });
}

function fieldKind(p: SchemaProp): FieldKind {
  if (p.type === 'boolean') return 'boolean';
  if (p.type === 'array') {
    if (p.items?.enum?.length) return 'multiselect';
    return 'text';
  }
  if (p.enum?.length) return 'enum';
  if (p.type === 'number' || p.type === 'integer') return 'number';
  return 'text';
}

// Derive an ordered row list from the schema: object props become a group header, then recurse.
function deriveRows(schema: Schema): Row[] {
  const rows: Row[] = [];
  const walk = (
    key: string,
    p: SchemaProp,
    path: string[],
    depth: number,
    required: boolean,
  ) => {
    if (p.type === 'object' && p.properties) {
      rows.push({
        kind: 'group',
        key: `${path.join('.')}:g`,
        depth,
        title: p.title ?? key,
      });
      const reqSet = new Set(p.required ?? []);
      for (const [k, child] of Object.entries(p.properties)) {
        walk(k, child, [...path, k], depth + 1, reqSet.has(k));
      }
      return;
    }
    const pathKey = path.join('.');
    rows.push({
      kind: 'field',
      field: {
        path,
        pathKey,
        depth,
        label: p.title ?? key,
        description: p.description,
        kind: fieldKind(p),
        options: normalizeEnum(p.enum) ?? normalizeEnum(p.items?.enum),
        required,
        min: p.minimum,
        max: p.maximum,
        minLength: p.minLength,
        maxLength: p.maxLength,
        default: p.default,
      },
    });
  };

  if (schema.type === 'object' && schema.properties) {
    const reqSet = new Set(schema.required ?? []);
    for (const [k, p] of Object.entries(schema.properties)) {
      walk(k, p, [k], 0, reqSet.has(k));
    }
  } else {
    walk('value', schema, ['value'], 0, false);
  }
  return rows;
}

function initValues(rows: Row[]): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.kind !== 'field') continue;
    const f = row.field;
    const d = f.default;
    if (f.kind === 'boolean') v[f.pathKey] = d ?? false;
    else if (f.kind === 'multiselect') {
      v[f.pathKey] = Array.isArray(d) ? d : d != null ? [d] : [];
    } else if (f.kind === 'enum') {
      v[f.pathKey] = d ?? f.options?.[0]?.value ?? '';
    } else v[f.pathKey] = d ?? '';
  }
  return v;
}

function validate(fields: Field[], values: Record<string, unknown>): string {
  for (const f of fields) {
    const v = values[f.pathKey];
    if (f.required) {
      const empty =
        v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (empty) return `${f.label} is required`;
    }
    if (f.kind === 'number' && v !== '' && v != null) {
      const n = Number(v);
      if (Number.isNaN(n)) return `${f.label} must be a number`;
      if (f.min != null && n < f.min) return `${f.label} must be ≥ ${f.min}`;
      if (f.max != null && n > f.max) return `${f.label} must be ≤ ${f.max}`;
    }
    if (f.kind === 'text' && typeof v === 'string') {
      if (f.minLength != null && v.length < f.minLength) {
        return `${f.label} too short (min ${f.minLength})`;
      }
      if (f.maxLength != null && v.length > f.maxLength) {
        return `${f.label} too long (max ${f.maxLength})`;
      }
    }
  }
  return '';
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

// Renders node.awaitingInput as a schema-driven form in a bordered panel; owns the
// keyboard while mounted (↑↓ navigate, Enter submit, ◀▶/Space toggle, Esc/Ctrl-C abort).
export const AskUserForm = observer(function AskUserForm({
  node,
  cols,
}: {
  node: MessageNode;
  cols: number;
}) {
  const chat = useStore('chat');
  const awaiting = node.awaitingInput!;
  const schema = awaiting.schema as Schema;
  const rows = deriveRows(schema);
  const fields: Field[] = rows
    .filter((r): r is Extract<Row, { kind: 'field' }> => r.kind === 'field')
    .map(r => r.field);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initValues(rows),
  );
  const [focusIdx, setFocusIdx] = useState(0);
  const [multiCursor, setMultiCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const submitIdx = fields.length;
  const labelW = fields.reduce((m, f) => Math.max(m, f.label.length), 0);
  const inner = Math.max(1, cols - 2);
  const focusedField = fields[focusIdx];

  async function submit() {
    const err = validate(fields, values);
    if (err) {
      setSubmitError(err);
      return;
    }
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      let v = values[f.pathKey];
      if (f.kind === 'number' && v !== '' && v != null) v = Number(v);
      setPath(data, f.path, v);
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await chat.submitHumanInput({ messageId: node.id, data });
    } catch (e) {
      setSubmitError(String(e instanceof Error ? e.message : e));
      setSubmitting(false);
    }
  }

  useKeyboard(data => {
    if (submitting) return;
    const quit =
      data === '\x1b' ||
      data === '\x03' ||
      (data === 'q' &&
        focusedField != null &&
        focusedField.kind !== 'text' &&
        focusedField.kind !== 'number');
    if (quit) {
      void chat.cancelChat({
        conversationId: node.conversationId,
        messageId: node.id,
      });
      return;
    }
    if (data === '\x1b[A' || data === '\x1b[B') {
      const dir = data === '\x1b[B' ? 1 : -1;
      setFocusIdx(i => (i + dir + submitIdx + 1) % (submitIdx + 1));
      setMultiCursor(0);
      return;
    }
    if (data === '\r') {
      if (focusIdx === submitIdx) submit();
      else {
        setFocusIdx(i => Math.min(submitIdx, i + 1));
        setMultiCursor(0);
      }
      return;
    }
    const f = focusedField;
    if (!f) return;
    if (f.kind === 'boolean' && (data === '\x1b[D' || data === '\x1b[C')) {
      setValues(v => ({ ...v, [f.pathKey]: !v[f.pathKey] }));
      return;
    }
    if (
      f.kind === 'enum' &&
      f.options &&
      (data === '\x1b[D' || data === '\x1b[C')
    ) {
      setValues(v => {
        const idx = Math.max(
          0,
          f.options!.findIndex(o => o.value === v[f.pathKey]),
        );
        const next =
          (idx + (data === '\x1b[C' ? 1 : -1) + f.options!.length) %
          f.options!.length;
        return { ...v, [f.pathKey]: f.options![next].value };
      });
      return;
    }
    if (f.kind === 'multiselect' && f.options) {
      const n = f.options.length;
      if (data === '\x1b[D' || data === '\x1b[C') {
        setMultiCursor(c =>
          n ? (c + (data === '\x1b[C' ? 1 : -1) + n) % n : 0,
        );
        return;
      }
      if (data === ' ') {
        const cur = f.options[n ? multiCursor % n : 0];
        if (cur) {
          setValues(v => {
            const raw = v[f.pathKey];
            const arr = Array.isArray(raw) ? [...(raw as unknown[])] : [];
            const at = arr.findIndex(x => x === cur.value);
            if (at >= 0) arr.splice(at, 1);
            else arr.push(cur.value);
            return { ...v, [f.pathKey]: arr };
          });
        }
      }
    }
  });

  const renderControl = (f: Field, focused: boolean): ReactNode => {
    if (f.kind === 'boolean') {
      return (
        <Text fg={focused ? 'cyan' : 'white'}>
          {values[f.pathKey] ? '● yes' : '○ no'}
        </Text>
      );
    }
    if (f.kind === 'enum') {
      const cur = f.options?.find(o => o.value === values[f.pathKey]);
      return (
        <Text
          fg={focused ? 'cyan' : 'white'}
        >{`${cur?.label ?? '?'} ◀▶`}</Text>
      );
    }
    if (f.kind === 'multiselect') {
      const raw = values[f.pathKey];
      const arr: unknown[] = Array.isArray(raw) ? raw : [];
      const opts = f.options ?? [];
      const ci = opts.length ? multiCursor % opts.length : -1;
      return (
        <>
          {opts.map((o, oi) => {
            const sel = arr.includes(o.value);
            const isCur = focused && oi === ci;
            return (
              <Text
                key={oi}
                fg={isCur ? 'cyan' : sel ? 'white' : 'gray'}
              >{`${sel ? '●' : '○'}${o.label} `}</Text>
            );
          })}
          {focused && <Text fg="gray">{'◀▶␣'}</Text>}
        </>
      );
    }
    return (
      <Input
        value={String(values[f.pathKey] ?? '')}
        onChange={v => setValues(prev => ({ ...prev, [f.pathKey]: v }))}
        enabled={focused}
        fg="white"
      />
    );
  };

  return (
    <BorderedBox title="ask_user" cols={cols}>
      {awaiting.message && (
        <Markdown text={awaiting.message} width={inner - 2} />
      )}
      {rows.map(row => {
        if (row.kind === 'group') {
          return (
            <Box key={row.key}>
              <Text fg="cyan">{`${' '.repeat(row.depth * 2 + 1)}${row.title}`}</Text>
            </Box>
          );
        }
        const f = row.field;
        const focused = focusedField?.pathKey === f.pathKey;
        const indent = ' '.repeat(f.depth * 2 + 1);
        const label = f.label.padEnd(labelW);
        return (
          <Box key={f.pathKey} flexDirection="column">
            <Box>
              <Text fg="gray">{`${indent}${label}  `}</Text>
              {renderControl(f, focused)}
            </Box>
            {f.description && (
              <Text fg="gray">{`${indent}${' '.repeat(labelW)}  ${f.description}`}</Text>
            )}
          </Box>
        );
      })}
      {submitError && <Text fg="red">{` ${submitError}`}</Text>}
      <Box>
        <Text fg={focusIdx === submitIdx ? 'cyan' : 'gray'}>
          {`  [ ${submitting ? 'submitting…' : 'Submit'} ]`}
        </Text>
      </Box>
      <Text fg="gray">
        {' ↑↓ navigate · ◀▶ change · ␣ toggle · Enter submit · q/Esc cancel'}
      </Text>
    </BorderedBox>
  );
});
