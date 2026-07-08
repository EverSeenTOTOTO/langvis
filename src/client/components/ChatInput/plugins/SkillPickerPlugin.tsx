import { mergeRegister } from '@lexical/utils';
import { Tag } from 'antd';
import clsx from 'clsx';
import {
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAsyncFn } from 'react-use';
import { useStore } from '@/client/store';
import type { SkillInfo } from '@/shared/types';
import { VariablePlugin } from './VariablePlugin';
import type { InlineControlProps, VariablePopoverRenderArgs } from './types';

/** Trailing boundary required so a token only chips once a space/punct follows —
 *  this keeps the popover usable while the user is still typing the query. */
const BOUNDARY = `[\\s.,;:!?)>]`;

const buildSkillPattern = (skills: SkillInfo[]): RegExp => {
  if (skills.length === 0) return /.^/g; // never matches until skills load
  // Longest ids first so a prefixed id (e.g. `doc` vs `document`) wins the match.
  const alt = [...skills]
    .map(s => s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|');
  return new RegExp(`/(?:${alt})(?=${BOUNDARY})`, 'g');
};

/** Inline chip rendered for each `/skill-id`. Stable identity for the registry. */
const SkillChip: React.FC<InlineControlProps> = ({ text, data }) => {
  const skill = data as SkillInfo | undefined;
  return (
    <Tag color="blue" style={{ margin: 0 }} title={text}>
      {skill?.name ?? text}
    </Tag>
  );
};

const SkillList: React.FC<{
  skills: SkillInfo[];
  query: string;
  insert: VariablePopoverRenderArgs['insert'];
  close: () => void;
  editor: LexicalEditor;
}> = ({ skills, query, insert, close, editor }) => {
  const settingStore = useStore('setting');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      s => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive(0);
  }, [query]);

  const choose = useCallback(
    (skill: SkillInfo) => {
      insert({ text: `/${skill.id}`, data: skill });
      close();
    },
    [insert, close],
  );

  // Keyboard nav while the popover is mounted (editor keeps focus).
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        () => {
          setActive(i => Math.min(i + 1, filtered.length - 1));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        () => {
          setActive(i => Math.max(i - 1, 0));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event: KeyboardEvent) => {
          if (event.ctrlKey || event.metaKey) return false; // let Ctrl/Cmd+Enter submit
          const skill = filtered[active];
          if (!skill) return false;
          event.preventDefault();
          choose(skill);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, filtered, active, choose]);

  if (filtered.length === 0) {
    return (
      <div className="chat-input-popover-empty">
        {settingStore.tr('No matching skills')}
      </div>
    );
  }

  return (
    <>
      {filtered.map((skill, i) => (
        <div
          key={skill.id}
          className={clsx(
            'chat-input-popover-item',
            i === active && 'is-active',
          )}
          onMouseDown={e => e.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => choose(skill)}
        >
          <span className="chat-input-popover-item-title">{skill.name}</span>
          <span className="chat-input-popover-item-desc">
            {skill.description || `/${skill.id}`}
          </span>
        </div>
      ))}
    </>
  );
};

/**
 * Concrete demo wiring `/` to an agent-skill picker:
 * type `/` → popover lists skills (filtered as you type); pick one (click or
 * ↑↓+Enter) → a highlighted `/skill-id` chip is inserted. Paste/type of a known
 * `/skill-id` followed by a boundary also becomes a chip via ReplacePlugin.
 */
export const SkillPickerPlugin: React.FC = () => {
  const agentStore = useStore('agent');
  const [skillState, fetchSkills] = useAsyncFn(() => agentStore.listSkills());
  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);
  const skills = skillState.value ?? [];

  const pattern = useMemo(() => buildSkillPattern(skills), [skills]);
  const createData = useCallback(
    (match: RegExpExecArray) => {
      const id = match[0].slice(1);
      return skills.find(s => s.id === id);
    },
    [skills],
  );
  const popoverRender = useCallback(
    (args: VariablePopoverRenderArgs) => (
      <SkillList
        skills={skills}
        query={args.query}
        insert={args.insert}
        close={args.close}
        editor={args.editor}
      />
    ),
    [skills],
  );

  return (
    <VariablePlugin
      name="skill"
      trigger="/"
      pattern={pattern}
      popoverRender={popoverRender}
      contentRender={SkillChip}
      swallow={false}
      minLength={0}
      requireBoundary
      createData={createData}
    />
  );
};
