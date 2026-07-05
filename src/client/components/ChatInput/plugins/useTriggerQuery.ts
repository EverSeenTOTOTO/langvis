import { useCallback } from 'react';

export interface TriggerMatch {
  /** Which trigger string opened the match. */
  trigger: string;
  /** Index in the input text where the trigger+query starts. */
  leadOffset: number;
  /** Text typed after the trigger, excluding the trigger itself. */
  matchingString: string;
  /** The trigger plus the query (i.e. the whole span to replace on insert). */
  replaceableString: string;
}

export interface TriggerQueryOptions {
  /** Minimum query length (after the trigger) for a match to count. Default 1. */
  minLength?: number;
  /** Maximum query length. Default 75. */
  maxLength?: number;
  /**
   * Only match when the trigger sits at the start of the text or right after
   * whitespace — prevents firing inside paths/URLs like `a/b` or `http://x/`.
   * Default false.
   */
  requireBoundary?: boolean;
}

const escapeForCharacterClass = (value: string) =>
  value.replace(/[[\]\\^-]/g, '\\$&');

/**
 * Build a predicate that scans text *ending at the caret* for an active trigger.
 * Adapted from dify's useBasicTypeaheadTriggerMatch; supports multiple triggers
 * and an optional leading-boundary requirement.
 *
 * Pass it the text from the start of the caret's text node up to the caret offset;
 * it returns the match closest to the caret, or null.
 */
export function useTriggerQuery(
  trigger: string | string[],
  {
    minLength = 1,
    maxLength = 75,
    requireBoundary = false,
  }: TriggerQueryOptions = {},
): (text: string) => TriggerMatch | null {
  const triggers = Array.isArray(trigger) ? trigger : [trigger];
  const key = `${triggers.join(' ')}|${requireBoundary}`;

  return useCallback(
    (text: string) => {
      for (const t of triggers) {
        const escaped = escapeForCharacterClass(t);
        const validChars = `[^${escaped}\\n\\r]`;
        // With requireBoundary the trigger must follow start-or-whitespace;
        // otherwise it may appear anywhere before the caret.
        const prefix = requireBoundary ? `(^|[\\s])` : `(.*)`;
        const re = new RegExp(
          prefix +
            '(' +
            `[${escaped}]` +
            `((?:${validChars}){0,${maxLength}})` +
            ')$',
        );
        const match = re.exec(text);
        if (match) {
          const leading = match[1] ?? '';
          const matchingString = match[3] ?? '';
          if (matchingString.length >= minLength) {
            return {
              trigger: t,
              leadOffset: match.index + leading.length,
              matchingString,
              replaceableString: match[2] ?? '',
            };
          }
        }
      }
      return null;
    },
    // `triggers` may be a fresh array each render; depend on its serialized form.
    [key, minLength, maxLength],
  );
}
