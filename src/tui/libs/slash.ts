import type { SkillInfo } from '@/shared/types/agent';

// Unified `/` command model for the TUI palette: skills (insert /skill-id) plus
// the fixed config commands Chat.tsx already dispatches.

export type SlashCmd = 'model' | 'conv' | 'new' | 'resume' | 'logout' | 'help';

export type SlashEntry =
  | { kind: 'skill'; skill: SkillInfo } // insert /skill-id at the caret
  | { kind: 'cmd'; cmd: SlashCmd }; // open picker or run the action

export interface SlashCommandMeta {
  cmd: SlashCmd;
  token: string;
  desc: string;
}

export const SLASH_COMMANDS: SlashCommandMeta[] = [
  { cmd: 'conv', token: '/conv', desc: 'switch conversation' },
  { cmd: 'model', token: '/model', desc: 'switch model' },
  { cmd: 'new', token: '/new', desc: 'new conversation' },
  { cmd: 'resume', token: '/resume', desc: 'retry from a past message' },
  { cmd: 'logout', token: '/logout', desc: 'sign out' },
  { cmd: 'help', token: '/help', desc: 'list commands' },
];

// Caret-ending slash token after a start-or-whitespace boundary → the bare
// query ('' for a bare `/`), or null when the caret is inside a slash token.
export function computeSlashQuery(textBeforeCaret: string): string | null {
  const m = /(?:^|\s)\/(\S*)$/.exec(textBeforeCaret);
  return m ? m[1] : null;
}

// Config commands first (fixed, always available), then dynamic skills.
export function buildEntries(skills: SkillInfo[]): SlashEntry[] {
  return [
    ...SLASH_COMMANDS.map(c => ({ kind: 'cmd' as const, cmd: c.cmd })),
    ...skills.map(s => ({ kind: 'skill' as const, skill: s })),
  ];
}

// Case-insensitive substring match on token/id/name — mirrors the web picker.
export function filterEntries(
  entries: SlashEntry[],
  query: string,
): SlashEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(e => {
    if (e.kind === 'cmd') {
      const meta = SLASH_COMMANDS.find(c => c.cmd === e.cmd)!;
      return meta.token.toLowerCase().includes(q);
    }
    return (
      e.skill.id.toLowerCase().includes(q) ||
      e.skill.name.toLowerCase().includes(q)
    );
  });
}

/** Stable display label for an entry: `/token` or the skill id. */
export function entryToken(e: SlashEntry): string {
  if (e.kind === 'cmd') {
    return SLASH_COMMANDS.find(c => c.cmd === e.cmd)!.token;
  }
  return `/${e.skill.id}`;
}

/** Stable display description: cmd description or the skill name. */
export function entryDesc(e: SlashEntry): string {
  if (e.kind === 'cmd') {
    return SLASH_COMMANDS.find(c => c.cmd === e.cmd)!.desc;
  }
  return e.skill.name;
}
