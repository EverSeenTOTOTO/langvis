import { Prompt } from '@/server/core/PromptBuilder';
import { describe, expect, it } from 'vitest';

describe('Prompt', () => {
  describe('empty', () => {
    it('should create an empty prompt', () => {
      const prompt = Prompt.empty();
      expect(prompt.build()).toBe('');
    });
  });

  describe('of', () => {
    it('should create a prompt from sections', () => {
      const prompt = Prompt.of([
        { name: 'Role', content: 'You are an assistant.' },
        { name: 'Task', content: 'Help users.' },
      ]);
      expect(prompt.build()).toBe(
        `## Role
You are an assistant.

## Task
Help users.`,
      );
    });
  });

  describe('concat', () => {
    it('should concatenate two prompts', () => {
      const prompt1 = Prompt.of([{ name: 'Role', content: 'Assistant' }]);
      const prompt2 = Prompt.of([{ name: 'Task', content: 'Help' }]);
      const result = prompt1.concat(prompt2);

      expect(result.build()).toBe(`## Role
Assistant

## Task
Help`);
    });

    it('should not modify original prompts', () => {
      const prompt1 = Prompt.of([{ name: 'Role', content: 'Assistant' }]);
      const prompt2 = Prompt.of([{ name: 'Task', content: 'Help' }]);

      prompt1.concat(prompt2);

      expect(prompt1.build()).toBe('## Role\nAssistant');
      expect(prompt2.build()).toBe('## Task\nHelp');
    });
  });

  describe('map', () => {
    it('should transform each section', () => {
      const prompt = Prompt.of([
        { name: 'Role', content: 'assistant' },
        { name: 'Task', content: 'help' },
      ]);

      const result = prompt.map(s => ({
        name: s.name.toUpperCase(),
        content: s.content.toUpperCase(),
      }));

      expect(result.get('ROLE')).toEqual({
        name: 'ROLE',
        content: 'ASSISTANT',
      });
      expect(result.get('TASK')).toEqual({ name: 'TASK', content: 'HELP' });
    });
  });

  describe('chain', () => {
    it('should create new prompt based on sections', () => {
      const prompt = Prompt.of([
        { name: 'Role', content: 'Assistant' },
        { name: 'Task', content: 'Help' },
      ]);

      const result = prompt.chain(sections =>
        Prompt.of(sections.filter(s => s.name === 'Role')),
      );

      expect(result.build()).toBe('## Role\nAssistant');
    });
  });

  describe('reduce', () => {
    it('should reduce sections to a value', () => {
      const prompt = Prompt.of([
        { name: 'A', content: 'a' },
        { name: 'B', content: 'b' },
        { name: 'C', content: 'c' },
      ]);

      const names = prompt.reduce<string[]>((acc, s) => [...acc, s.name], []);

      expect(names).toEqual(['A', 'B', 'C']);
    });
  });

  describe('with', () => {
    it('should append a section', () => {
      const prompt = Prompt.empty()
        .with('Role', 'You are an assistant.')
        .with('Task', 'Help users.');

      expect(prompt.build()).toBe(
        `## Role
You are an assistant.

## Task
Help users.`,
      );
    });

    it('should be chainable', () => {
      const prompt = Prompt.empty()
        .with('A', '1')
        .with('B', '2')
        .with('C', '3');

      expect(prompt.build()).toBe(`## A
1

## B
2

## C
3`);
    });
  });

  describe('with - override behavior', () => {
    it('should override an existing section', () => {
      const prompt = Prompt.empty()
        .with('Role', 'Original')
        .with('Role', 'Overridden');

      expect(prompt.get('Role')).toEqual({
        name: 'Role',
        content: 'Overridden',
      });
    });

    it('should return new prompt without modifying original when overriding', () => {
      const original = Prompt.empty().with('Role', 'Original');
      const overridden = original.with('Role', 'Overridden');

      expect(original.get('Role')).toEqual({
        name: 'Role',
        content: 'Original',
      });
      expect(overridden.get('Role')).toEqual({
        name: 'Role',
        content: 'Overridden',
      });
    });

    it('should add section if not exists', () => {
      const prompt = Prompt.empty().with('NonExistent', 'New content');

      expect(prompt.has('NonExistent')).toBe(true);
      expect(prompt.get('NonExistent')?.content).toBe('New content');
    });
  });

  describe('without', () => {
    it('should remove a section', () => {
      const prompt = Prompt.empty().with('A', '1').with('B', '2').without('A');

      expect(prompt.has('A')).toBe(false);
      expect(prompt.has('B')).toBe(true);
    });

    it('should return same prompt if section not found', () => {
      const prompt = Prompt.empty().with('A', '1');
      const result = prompt.without('NonExistent');

      expect(result.build()).toBe('## A\n1');
    });
  });

  describe('insertAfter', () => {
    it('should insert after specified section', () => {
      const prompt = Prompt.empty()
        .with('A', '1')
        .with('B', '2')
        .insertAfter('A', 'Middle', '1.5');

      const built = prompt.build();
      expect(built).toBe(`## A
1

## Middle
1.5

## B
2`);
    });

    it('should append at end if target not found', () => {
      const prompt = Prompt.empty()
        .with('A', '1')
        .insertAfter('NonExistent', 'New', 'value');

      expect(prompt.build()).toBe(`## A
1

## New
value`);
    });

    it('should insert after last section', () => {
      const prompt = Prompt.empty()
        .with('A', '1')
        .with('B', '2')
        .insertAfter('B', 'C', '3');

      expect(prompt.build()).toBe(`## A
1

## B
2

## C
3`);
    });
  });

  describe('insertBefore', () => {
    it('should insert before specified section', () => {
      const prompt = Prompt.empty()
        .with('A', '1')
        .with('B', '2')
        .insertBefore('B', 'Middle', '1.5');

      const built = prompt.build();
      expect(built).toBe(`## A
1

## Middle
1.5

## B
2`);
    });

    it('should append at end if target not found', () => {
      const prompt = Prompt.empty()
        .with('A', '1')
        .insertBefore('NonExistent', 'New', 'value');

      expect(prompt.build()).toBe(`## A
1

## New
value`);
    });

    it('should insert before first section', () => {
      const prompt = Prompt.empty()
        .with('A', '1')
        .with('B', '2')
        .insertBefore('A', 'Start', '0');

      expect(prompt.build()).toBe(`## Start
0

## A
1

## B
2`);
    });
  });

  describe('get', () => {
    it('should return section if exists', () => {
      const prompt = Prompt.empty().with('Role', 'Assistant');

      expect(prompt.get('Role')).toEqual({
        name: 'Role',
        content: 'Assistant',
      });
    });

    it('should return undefined if not exists', () => {
      const prompt = Prompt.empty();

      expect(prompt.get('NonExistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true if section exists', () => {
      const prompt = Prompt.empty().with('Role', 'Assistant');

      expect(prompt.has('Role')).toBe(true);
    });

    it('should return false if section not exists', () => {
      const prompt = Prompt.empty();

      expect(prompt.has('NonExistent')).toBe(false);
    });
  });

  describe('build', () => {
    it('should build empty string for empty prompt', () => {
      expect(Prompt.empty().build()).toBe('');
    });

    it('should build single section', () => {
      const prompt = Prompt.empty().with('Role', 'You are an assistant.');

      expect(prompt.build()).toBe('## Role\nYou are an assistant.');
    });

    it('should build multiple sections with correct format', () => {
      const prompt = Prompt.empty()
        .with('Role', 'Assistant')
        .with('Task', 'Help users')
        .with('Format', 'JSON');

      expect(prompt.build()).toBe(
        `## Role
Assistant

## Task
Help users

## Format
JSON`,
      );
    });

    it('should preserve newlines in content', () => {
      const prompt = Prompt.empty().with(
        'Rules',
        '1. Be helpful\n2. Be accurate\n3. Be concise',
      );

      expect(prompt.build()).toBe(
        `## Rules
1. Be helpful
2. Be accurate
3. Be concise`,
      );
    });
  });

  describe('immutability', () => {
    it('should not mutate original on with', () => {
      const original = Prompt.empty().with('A', '1');
      original.with('B', '2');

      expect(original.has('B')).toBe(false);
    });

    it('should not mutate original on with (override)', () => {
      const original = Prompt.empty().with('A', 'original');
      original.with('A', 'new');

      expect(original.get('A')?.content).toBe('original');
    });

    it('should not mutate original on without', () => {
      const original = Prompt.empty().with('A', '1').with('B', '2');
      original.without('A');

      expect(original.has('A')).toBe(true);
    });

    it('should not mutate original on insertAfter', () => {
      const original = Prompt.empty().with('A', '1');
      original.insertAfter('A', 'B', '2');

      expect(original.has('B')).toBe(false);
    });

    it('should not mutate original on insertBefore', () => {
      const original = Prompt.empty().with('B', '2');
      original.insertBefore('B', 'A', '1');

      expect(original.has('A')).toBe(false);
    });
  });
});
