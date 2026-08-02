// Comment-discipline rules (see CLAUDE.md): one comment per line; multi-line
// blocks need an allow marker on the opener; long lines are report-only.

const DEFAULT_ALLOW =
  '(^|\\s)(eslint-disable|@license|@preserve|copyright|allow\\b)(\\s|\\*|$|:)';
const DEFAULT_MAX_LEN = 100;
const EXEMPT_DIRECTIVE =
  /^(eslint-|@|ts-|istanbul|prettier-|vite-|webpack-|vitest|noinspection|\/|\s|!|#)/;

function allowReFrom(options) {
  const src = options?.allowMarker ?? DEFAULT_ALLOW;
  return new RegExp(src, 'i');
}

/** True when a block comment's first line carries an allow marker. */
function isAllowedMultiline(comment, allowRe) {
  const nl = comment.value.indexOf('\n');
  const firstLine = nl === -1 ? comment.value : comment.value.slice(0, nl);
  return allowRe.test(firstLine);
}

/** comment-one-line: block comments may span one line, else need an allow marker. */
function commentOneLineRule() {
  return {
    meta: {
      type: 'problem',
      fixable: 'code',
      docs: {
        description:
          'Reject multi-line comments unless the first line is an allow marker.',
      },
      messages: {
        multiLine:
          'Multi-line comment; keep it on one line or start it with an allow marker.',
      },
      schema: [
        {
          type: 'object',
          properties: { allowMarker: { type: 'string' } },
          additionalProperties: false,
        },
      ],
    },
    create(context) {
      const sourceCode = context.getSourceCode();
      const allowRe = allowReFrom(context.options?.[0]);
      return {
        'Program:exit'() {
          for (const comment of sourceCode.getAllComments()) {
            if (comment.type !== 'Block') continue;
            if (comment.loc.start.line === comment.loc.end.line) continue;
            if (isAllowedMultiline(comment, allowRe)) continue;
            context.report({
              loc: comment.loc,
              messageId: 'multiLine',
              fix(fixer) {
                // `{/* ... */}`: collapsing would comment out the closing `}` — report-only.
                const before = sourceCode
                  .getText()
                  .slice(0, comment.range[0])
                  .replace(/\s+$/, '');
                if (before.endsWith('{')) return null;
                const body = comment.value
                  .split('\n')
                  .map(l => l.replace(/^\s*\*?\s*/, '').trim())
                  .filter(Boolean)
                  .join(' ');
                return fixer.replaceText(comment, `// ${body}`);
              },
            });
          }
        },
      };
    },
  };
}

// no-comment-runs: no 3 consecutive comment-only lines (`//`, `/*`, or a `*`
// continuation all count as comment lines).
function noCommentRunsRule() {
  return {
    meta: {
      type: 'problem',
      docs: { description: 'Reject three or more consecutive comment lines.' },
      messages: {
        run: '{{n}} consecutive comment lines — condense.',
      },
      schema: [],
    },
    create(context) {
      const sourceCode = context.getSourceCode();
      return {
        'Program:exit'() {
          const lines = sourceCode.getText().split('\n');
          let run = 0;
          let runStart = 1;
          for (let i = 0; i <= lines.length; i++) {
            const isComment =
              i < lines.length && /^\s*(\/\/|\/\*|\*)/.test(lines[i]);
            if (isComment) {
              if (run === 0) runStart = i + 1;
              run++;
            } else {
              if (run >= 3) {
                context.report({
                  loc: {
                    start: { line: runStart, column: 0 },
                    end: { line: runStart + run - 1, column: 0 },
                  },
                  messageId: 'run',
                  data: { n: run },
                });
              }
              run = 0;
            }
          }
        },
      };
    },
  };
}

/** comment-max-len: single-line comments stay under maxLen (directives exempt). */
function commentMaxLenRule() {
  return {
    meta: {
      type: 'problem',
      docs: { description: 'Reject over-long single-line comments.' },
      messages: {
        tooLong: 'Comment is {{len}} chars (max {{max}}).',
      },
      schema: [
        {
          type: 'object',
          properties: { maxLen: { type: 'number' } },
          additionalProperties: false,
        },
      ],
    },
    create(context) {
      const sourceCode = context.getSourceCode();
      const max = context.options?.[0]?.maxLen ?? DEFAULT_MAX_LEN;
      return {
        'Program:exit'() {
          for (const comment of sourceCode.getAllComments()) {
            // Multi-line comments are governed by comment-one-line, not length.
            if (
              comment.type === 'Block' &&
              comment.loc.start.line !== comment.loc.end.line
            ) {
              continue;
            }
            const body = comment.value.trim();
            if (EXEMPT_DIRECTIVE.test(body)) continue;
            if (body.length > max) {
              // Report-only: shortening an over-long comment is a rewrite, not a
              // mechanical transform — fix it by hand.
              context.report({
                loc: comment.loc,
                messageId: 'tooLong',
                data: { len: body.length, max },
              });
            }
          }
        },
      };
    },
  };
}

const plugin = {
  meta: { name: 'langvis', version: '0.0.1' },
  rules: {
    'comment-one-line': commentOneLineRule(),
    'no-comment-runs': noCommentRunsRule(),
    'comment-max-len': commentMaxLenRule(),
  },
};

export const rules = plugin.rules;
export default plugin;
