import { visualWidth } from './wrap';

export const PASTE_COLLAPSE_THRESHOLD = 200;

// A buffer is an ordered list of segments. `text` holds normal chars; `paste`
// holds a large blob rendered as a short label and edited as one atomic unit.
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'paste'; text: string };
export type Buffer = { segs: Segment[] };
export type EditResult = { buffer: Buffer; cursor: number; submit?: boolean };

// Paste label shown in place of a collapsed blob (its real text is expanded at send).
export function pasteLabel(text: string): string {
  return `⟨pasted · ${text.length} chars⟩`;
}

export function emptyBuffer(): Buffer {
  return { segs: [] };
}

const normalize = (s: string): string =>
  s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// Logical unit count: every text char is a unit, a paste blob is a single unit.
function count(seg: Segment): number {
  return seg.kind === 'text' ? seg.text.length : 1;
}

function totalUnits(buf: Buffer): number {
  let n = 0;
  for (const s of buf.segs) n += count(s);
  return n;
}

// Real text to send: concatenates text segments verbatim and expands paste blobs.
export function bufferText(buf: Buffer): string {
  return buf.segs.map(s => s.text).join('');
}

// Real text of the units strictly before boundary k (paste blobs expand).
export function textBeforeUnit(buf: Buffer, k: number): string {
  let out = '';
  let u = 0;
  for (const seg of buf.segs) {
    if (seg.kind === 'paste') {
      if (u < k) out += seg.text;
      u++;
    } else {
      if (u < k) out += seg.text.slice(0, k - u);
      u += seg.text.length;
    }
    if (u >= k) break;
  }
  return out;
}

// Start boundary of a trailing `/\S*` token before k; the `/` must sit at a
// start/whitespace boundary (mirrors computeSlashQuery) or null is returned.
export function queryTokenStart(buf: Buffer, k: number): number | null {
  let i = k - 1;
  while (i >= 0) {
    const u = unitInfo(buf, i);
    if (u.paste) return null;
    if (u.ch === '/') {
      if (i === 0) return 0;
      const p = unitInfo(buf, i - 1);
      return p.paste || !/\s/.test(p.ch) ? null : i;
    }
    if (/\s/.test(u.ch)) return null;
    i--;
  }
  return null;
}

// Merge adjacent text segments and drop empty ones, keeping the buffer canonical.
function normalizeSegs(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segs) {
    if (seg.kind === 'text' && seg.text === '') continue;
    const last = out[out.length - 1];
    if (last && last.kind === 'text' && seg.kind === 'text') {
      out[out.length - 1] = { kind: 'text', text: last.text + seg.text };
    } else {
      out.push(seg);
    }
  }
  return out;
}

// Boundary `k` ("number of units before it") → (seg index, offset within seg).
function posAt(buf: Buffer, k: number): { seg: number; off: number } {
  let remain = k;
  for (let i = 0; i < buf.segs.length; i++) {
    const c = count(buf.segs[i]);
    if (remain < c) return { seg: i, off: remain };
    remain -= c;
  }
  return { seg: buf.segs.length, off: remain };
}

// What a single unit is: a paste unit or the char of a text segment.
function unitInfo(buf: Buffer, u: number): { paste: boolean; ch: string } {
  for (const seg of buf.segs) {
    if (seg.kind === 'paste') {
      if (u === 0) return { paste: true, ch: '' };
      u--;
    } else if (u < seg.text.length) {
      return { paste: false, ch: seg.text[u] };
    } else {
      u -= seg.text.length;
    }
  }
  return { paste: false, ch: '' };
}

// Insert text at boundary k; a text segment is split, otherwise the text lands
// in (or becomes) the neighbouring text segment, clear of paste blobs.
function insertText(
  buf: Buffer,
  k: number,
  s: string,
): { buffer: Buffer; cursor: number } {
  if (s === '') return { buffer: buf, cursor: k };
  const segs = buf.segs.slice();
  const pos = posAt(buf, k);
  const L = s.length;
  if (pos.seg < segs.length && segs[pos.seg].kind === 'text') {
    const o = pos.off;
    const t = segs[pos.seg].text;
    segs[pos.seg] = { kind: 'text', text: t.slice(0, o) + s + t.slice(o) };
    return { buffer: { segs: normalizeSegs(segs) }, cursor: k + L };
  }
  let ins: number;
  if (segs.length === 0) ins = 0;
  else if (pos.seg >= segs.length) ins = segs.length;
  else if (segs[pos.seg].kind === 'paste')
    ins = pos.off === 0 ? pos.seg : pos.seg + 1;
  else ins = pos.seg + 1; // boundary at end of a text seg
  const prev = ins - 1;
  const next = ins;
  if (prev >= 0 && segs[prev].kind === 'text') {
    segs[prev] = { kind: 'text', text: segs[prev].text + s };
  } else if (next < segs.length && segs[next].kind === 'text') {
    segs[next] = { kind: 'text', text: s + segs[next].text };
  } else {
    segs.splice(ins, 0, { kind: 'text', text: s });
  }
  return { buffer: { segs: normalizeSegs(segs) }, cursor: k + L };
}

// Insert pasted text at boundary k; blobs above the threshold collapse into one
// atomic paste segment, shorter pastes go inline as normal text.
export function insertPaste(
  buf: Buffer,
  k: number,
  text: string,
): { buffer: Buffer; cursor: number } {
  const norm = normalize(text);
  if (norm.length <= PASTE_COLLAPSE_THRESHOLD) return insertText(buf, k, norm);
  const segs = buf.segs.slice();
  const pos = posAt(buf, k);
  if (pos.seg < segs.length && segs[pos.seg].kind === 'text') {
    const o = pos.off;
    const t = segs[pos.seg].text;
    if (o > 0 && o < t.length) {
      segs.splice(
        pos.seg,
        1,
        { kind: 'text', text: t.slice(0, o) },
        { kind: 'paste', text: norm },
        { kind: 'text', text: t.slice(o) },
      );
      return { buffer: { segs: normalizeSegs(segs) }, cursor: k + 1 };
    }
    const ins = o === 0 ? pos.seg : pos.seg + 1;
    segs.splice(ins, 0, { kind: 'paste', text: norm });
    return { buffer: { segs: normalizeSegs(segs) }, cursor: k + 1 };
  }
  const ins =
    pos.seg >= segs.length
      ? segs.length
      : pos.off === 0
        ? pos.seg
        : pos.seg + 1;
  segs.splice(ins, 0, { kind: 'paste', text: norm });
  return { buffer: { segs: normalizeSegs(segs) }, cursor: k + 1 };
}

// Insert text at boundary k as normal inline text (no paste-collapse);
// cursor lands after the inserted text. Used by voice backfill.
export function insertTextAt(
  buf: Buffer,
  k: number,
  text: string,
): { buffer: Buffer; cursor: number } {
  return insertText(buf, k, normalize(text));
}

// Delete the unit right before boundary k; a paste unit is removed whole.
function deleteBack(
  buf: Buffer,
  k: number,
): { buffer: Buffer; cursor: number } | null {
  if (k <= 0 || totalUnits(buf) === 0) return null;
  const segs = buf.segs.slice();
  let u = k - 1;
  for (let i = 0; i < segs.length; i++) {
    const c = count(segs[i]);
    if (u < c) {
      if (segs[i].kind === 'paste') {
        segs.splice(i, 1);
      } else {
        const t = segs[i].text;
        segs[i] = { kind: 'text', text: t.slice(0, u) + t.slice(u + 1) };
      }
      return { buffer: { segs: normalizeSegs(segs) }, cursor: k - 1 };
    }
    u -= c;
  }
  return null;
}

// Drop units in [a, b); keeps whole paste units outside the range.
export function removeRange(buf: Buffer, a: number, b: number): Buffer {
  if (a >= b) return buf;
  const out: Segment[] = [];
  let u = 0;
  let cur = '';
  const flush = () => {
    if (cur !== '') {
      out.push({ kind: 'text', text: cur });
      cur = '';
    }
  };
  for (const seg of buf.segs) {
    if (seg.kind === 'paste') {
      if (u < a || u >= b) {
        flush();
        out.push(seg);
      }
      u++;
    } else {
      for (const ch of [...seg.text]) {
        if (!(u >= a && u < b)) cur += ch;
        u++;
      }
    }
  }
  flush();
  return { segs: out };
}

// Units of the word (and nothing else) before boundary k; never crosses a newline.
function wordBackStart(buf: Buffer, k: number): number {
  let u = k - 1;
  while (u >= 0) {
    const i = unitInfo(buf, u);
    if (i.paste || (i.ch !== ' ' && i.ch !== '\t')) break;
    u--;
  }
  while (u >= 0) {
    const i = unitInfo(buf, u);
    if (i.paste) {
      u--;
      break;
    }
    if (/\s/.test(i.ch)) break;
    u--;
  }
  return u + 1;
}

function lineStartUnits(buf: Buffer, k: number): number {
  let s = 0;
  for (let u = k - 1; u >= 0; u--) {
    const i = unitInfo(buf, u);
    if (!i.paste && i.ch === '\n') {
      s = u + 1;
      break;
    }
  }
  return s;
}

function lineEndUnits(buf: Buffer, k: number): number {
  const total = totalUnits(buf);
  let e = total;
  for (let u = k; u < total; u++) {
    const i = unitInfo(buf, u);
    if (!i.paste && i.ch === '\n') {
      e = u;
      break;
    }
  }
  return e;
}

// Hard-wrap rows by unit, keeping each paste label on one row. Display text only
// (paste blobs render as their label).
export type VisualRow = { text: string };

export function visualRows(buf: Buffer, width: number): VisualRow[] {
  const w = Math.max(1, Math.floor(width));
  const rows: VisualRow[] = [];
  let curWidth = 0;
  let curText = '';
  const flush = () => {
    rows.push({ text: curText });
    curText = '';
    curWidth = 0;
  };
  for (const seg of buf.segs) {
    if (seg.kind === 'paste') {
      const label = pasteLabel(seg.text);
      const lw = visualWidth(label);
      if (curWidth > 0 && curWidth + lw > w) flush();
      curText += label;
      curWidth += lw;
      continue;
    }
    for (const ch of [...seg.text]) {
      if (ch === '\n') {
        flush();
        continue;
      }
      const cw = visualWidth(ch);
      if (curWidth > 0 && curWidth + cw > w) flush();
      curText += ch;
      curWidth += cw;
    }
  }
  // Preserve the trailing blank row when the buffer ends with a newline — the
  // Enter-continuation caret lives on it (visualRows swallows a trailing \n).
  const last = buf.segs[buf.segs.length - 1];
  if (last?.kind === 'text' && last.text.endsWith('\n'))
    rows.push({ text: '' });
  else if (curText !== '' || rows.length === 0) rows.push({ text: curText });
  return rows;
}

// Boundary k → (row, col in visual cells), for rendering the caret and up/down.
export function caretToXY(
  buf: Buffer,
  k: number,
  width: number,
): { row: number; col: number } {
  const w = Math.max(1, Math.floor(width));
  let row = 0;
  let curWidth = 0;
  let u = 0;
  for (const seg of buf.segs) {
    if (seg.kind === 'paste') {
      const uw = visualWidth(pasteLabel(seg.text));
      if (k === u) return { row, col: curWidth };
      if (curWidth > 0 && curWidth + uw > w) {
        row++;
        curWidth = 0;
      }
      curWidth += uw;
      u++;
      continue;
    }
    for (const ch of [...seg.text]) {
      if (ch === '\n') {
        if (k === u) return { row, col: curWidth };
        row++;
        curWidth = 0;
        u++;
        continue;
      }
      const cw = visualWidth(ch);
      if (k === u) return { row, col: curWidth };
      if (curWidth > 0 && curWidth + cw > w) {
        row++;
        curWidth = 0;
      }
      curWidth += cw;
      u++;
    }
  }
  return { row, col: curWidth };
}

// Reverse of caretToXY: the boundary nearest a visual (row, col). col beyond
// the target row's width clamps to that row's end (the standard arrow-key pad).
export function xyToOffset(
  buf: Buffer,
  row: number,
  col: number,
  width: number,
): number {
  if (row < 0) return 0;
  const w = Math.max(1, Math.floor(width));
  let r = 0;
  let curWidth = 0;
  let u = 0;
  for (const seg of buf.segs) {
    if (seg.kind === 'paste') {
      const uw = visualWidth(pasteLabel(seg.text));
      if (curWidth > 0 && curWidth + uw > w) {
        if (r === row) return u;
        r++;
        curWidth = 0;
      }
      if (r === row && curWidth + uw > col && curWidth <= col) {
        const before = col - curWidth;
        const after = curWidth + uw - col;
        return after > w || before <= after ? u : u + 1;
      }
      curWidth += uw;
      u++;
      continue;
    }
    for (const ch of [...seg.text]) {
      if (ch === '\n') {
        if (r === row) return u;
        r++;
        curWidth = 0;
        u++;
        continue;
      }
      const cw = visualWidth(ch);
      if (curWidth > 0 && curWidth + cw > w) {
        if (r === row) return u;
        r++;
        curWidth = 0;
      }
      if (r === row && curWidth + cw > col && curWidth <= col) return u;
      curWidth += cw;
      u++;
    }
  }
  return u;
}

// Char (UTF-16) index into a row's display text that places the caret at `col`
// visual cells (used to embed the block caret when rendering a row).
export function cellIndexAt(rowText: string, col: number): number {
  const target = Math.max(0, col);
  let w = 0;
  let ci = 0;
  for (const ch of rowText) {
    const cw = visualWidth(ch);
    if (w + cw > target) break;
    w += cw;
    ci += ch.length;
  }
  return ci;
}

// Interpret a key data chunk (see useKeyboard) against the buffer; null = ignore.
export function applyKey(
  data: string,
  buf: Buffer,
  cursor: number,
  width: number,
): EditResult | null {
  const total = totalUnits(buf);
  switch (data) {
    case '\r':
    case '\x1b[13;5u':
      // Send, unless the buffer ends with `\` → Enter strips it and joins lines.
      if (bufferText(buf).endsWith('\\')) {
        const cut = removeRange(buf, total - 1, total);
        const r = insertText(cut, total - 1, '\n');
        return { buffer: r.buffer, cursor: r.cursor, submit: false };
      }
      return { buffer: buf, cursor, submit: true };
    case '\x7f':
    case '\b': {
      const d = deleteBack(buf, cursor);
      return d ? { buffer: d.buffer, cursor: d.cursor, submit: false } : null;
    }
    case '\x1b[D':
      return { buffer: buf, cursor: Math.max(0, cursor - 1), submit: false };
    case '\x1b[C':
      return {
        buffer: buf,
        cursor: Math.min(total, cursor + 1),
        submit: false,
      };
    case '\x1b[A':
    case '\x10': {
      // Ctrl-p = up
      const { row, col } = caretToXY(buf, cursor, width);
      if (row === 0) return null;
      return {
        buffer: buf,
        cursor: xyToOffset(buf, row - 1, col, width),
        submit: false,
      };
    }
    case '\x1b[B':
    case '\x0e': {
      // Ctrl-n = down
      const { row, col } = caretToXY(buf, cursor, width);
      if (row >= visualRows(buf, width).length - 1) return null;
      return {
        buffer: buf,
        cursor: xyToOffset(buf, row + 1, col, width),
        submit: false,
      };
    }
    case '\x01':
      return {
        buffer: buf,
        cursor: lineStartUnits(buf, cursor),
        submit: false,
      };
    case '\x05':
      return { buffer: buf, cursor: lineEndUnits(buf, cursor), submit: false };
    case '\x1b[H':
      return { buffer: buf, cursor: 0, submit: false };
    case '\x1b[F':
      return { buffer: buf, cursor: total, submit: false };
    case '\x17': {
      const a = wordBackStart(buf, cursor);
      if (a === cursor) return null;
      return { buffer: removeRange(buf, a, cursor), cursor: a, submit: false };
    }
    case '\x15': {
      const a = lineStartUnits(buf, cursor);
      return { buffer: removeRange(buf, a, cursor), cursor: a, submit: false };
    }
    case '\x0b': {
      const e = lineEndUnits(buf, cursor);
      return { buffer: removeRange(buf, cursor, e), cursor, submit: false };
    }
    case '\x06':
      return {
        buffer: buf,
        cursor: Math.min(total, cursor + 1),
        submit: false,
      };
    case '\x02':
      return { buffer: buf, cursor: Math.max(0, cursor - 1), submit: false };
    case '\x07':
      // Ctrl-g clears the composed input (Ctrl-l is eaten by the terminal).
      return { buffer: emptyBuffer(), cursor: 0, submit: false };
    case '\t':
      return insertText(buf, cursor, '  ');
    default: {
      if (data.length === 1) {
        const code = data.charCodeAt(0);
        if (code < 0x20 || code === 0x7f) return null;
      }
      // multi-char chunks arrive via non-bracketed paste (e.g. tmux send-keys);
      // route them through the same collapse rule as system paste.
      return insertPaste(buf, cursor, normalize(data));
    }
  }
}
