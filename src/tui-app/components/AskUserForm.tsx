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
};
type Schema = {
  type?: string;
  title?: string;
  description?: string;
  enum?: EnumItem[];
  items?: { type?: string; enum?: EnumItem[] };
  default?: unknown;
  properties?: Record<string, SchemaProp>;
  required?: string[];
};

type FieldKind = 'text' | 'number' | 'boolean' | 'enum' | 'multiselect';
type Field = {
  key: string;
  label: string;
  description?: string;
  kind: FieldKind;
  options?: { label: string; value: string | number | boolean }[];
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
};

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
    return 'text'; // array-of-objects / plain array → text (deferred)
  }
  if (p.enum?.length) return 'enum';
  if (p.type === 'number' || p.type === 'integer') return 'number';
  return 'text';
}

function deriveFields(schema: Schema): Field[] {
  const required = schema.required ?? [];
  const fromProp = (key: string, p: SchemaProp): Field => ({
    key,
    label: p.title ?? key,
    description: p.description,
    kind: fieldKind(p),
    options: normalizeEnum(p.enum) ?? normalizeEnum(p.items?.enum),
    required: required.includes(key),
    min: p.minimum,
    max: p.maximum,
    minLength: p.minLength,
    maxLength: p.maxLength,
  });
  if (schema.type === 'object' && schema.properties) {
    return Object.entries(schema.properties).map(([k, p]) => fromProp(k, p));
  }
  return [fromProp('value', schema)];
}

function initValues(fields: Field[], schema: Schema): Record<string, unknown> {
  const defaults: Record<string, unknown> =
    schema.type === 'object' && schema.properties
      ? Object.fromEntries(
          Object.entries(schema.properties).map(([k, p]) => [k, p.default]),
        )
      : { value: schema.default };
  const v: Record<string, unknown> = {};
  for (const f of fields) {
    const d = defaults[f.key];
    if (f.kind === 'boolean') v[f.key] = d ?? false;
    else if (f.kind === 'multiselect') {
      v[f.key] = Array.isArray(d) ? d : d != null ? [d] : [];
    } else if (f.kind === 'enum') {
      v[f.key] = d ?? f.options?.[0]?.value ?? '';
    } else v[f.key] = d ?? '';
  }
  return v;
}

/** Validate against required / numeric range / string length. Returns the
 * first error message, or '' if valid. */
function validate(fields: Field[], values: Record<string, unknown>): string {
  for (const f of fields) {
    const v = values[f.key];
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

/** Renders `node.awaitingInput` as a schema-driven form in a bordered panel.
 * Owns the keyboard while mounted: ↑↓ navigate, Enter submits (or advances),
 * ◀▶ toggle booleans / cycle enums / move the multi-select cursor, Space
 * toggles a multi-select option, text/number fields type directly, Esc/Ctrl-C
 * aborts the run. Unmounts when the run resumes and awaitingInput clears. */
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
  const fields = deriveFields(schema);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initValues(fields, schema),
  );
  const [focusIdx, setFocusIdx] = useState(0);
  const [multiCursor, setMultiCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const submitIdx = fields.length; // index of the Submit row
  const labelW = fields.reduce((m, f) => Math.max(m, f.label.length), 0);
  const inner = Math.max(1, cols - 2);

  async function submit() {
    const err = validate(fields, values);
    if (err) {
      setSubmitError(err);
      return;
    }
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key];
      data[f.key] =
        f.kind === 'number' && v !== '' && v != null ? Number(v) : v;
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
    if (data === '\x1b' || data === '\x03') {
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
    const f = fields[focusIdx];
    if (!f) return;
    if (f.kind === 'boolean' && (data === '\x1b[D' || data === '\x1b[C')) {
      setValues(v => ({ ...v, [f.key]: !v[f.key] }));
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
          f.options!.findIndex(o => o.value === v[f.key]),
        );
        const next =
          (idx + (data === '\x1b[C' ? 1 : -1) + f.options!.length) %
          f.options!.length;
        return { ...v, [f.key]: f.options![next].value };
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
            const arr = Array.isArray(v[f.key])
              ? [...(v[f.key] as unknown[])]
              : [];
            const at = arr.findIndex(x => x === cur.value);
            if (at >= 0) arr.splice(at, 1);
            else arr.push(cur.value);
            return { ...v, [f.key]: arr };
          });
        }
      }
    }
    // text/number: the focused <Input> owns typing / cursor / backspace.
  });

  return (
    <BorderedBox title="ask_user" cols={cols}>
      {awaiting.message && (
        <Markdown text={awaiting.message} width={inner - 2} />
      )}
      {fields.map((f, i) => {
        const focused = i === focusIdx;
        const label = f.label.padEnd(labelW);
        const render = (): ReactNode => {
          if (f.kind === 'boolean') {
            return (
              <Text fg={focused ? 'cyan' : 'white'}>
                {values[f.key] ? '● yes' : '○ no'}
              </Text>
            );
          }
          if (f.kind === 'enum') {
            const cur = f.options?.find(o => o.value === values[f.key]);
            return (
              <Text fg={focused ? 'cyan' : 'white'}>
                {`${cur?.label ?? '?'} ◀▶`}
              </Text>
            );
          }
          if (f.kind === 'multiselect') {
            const raw = values[f.key];
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
              value={String(values[f.key] ?? '')}
              onChange={v => setValues(prev => ({ ...prev, [f.key]: v }))}
              enabled={focused}
              fg="white"
            />
          );
        };
        return (
          <Box key={f.key} flexDirection="column">
            <Box>
              <Text fg="gray">{` ${label}  `}</Text>
              {render()}
            </Box>
            {f.description && (
              <Text fg="gray">{` ${' '.repeat(labelW)}  ${f.description}`}</Text>
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
        {' ↑↓ navigate · ◀▶ change · ␣ toggle · Enter submit · Esc cancel'}
      </Text>
    </BorderedBox>
  );
});
