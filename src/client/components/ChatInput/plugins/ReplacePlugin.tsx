import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $isTextNode, TextNode } from 'lexical';
import { useEffect } from 'react';
import { $createInlineControlNode } from './InlineControlNode';
import { useRegisterRenderer } from './InlineControlRegistry';
import type { ReplacePluginProps } from './types';

/**
 * Replaces every `pattern` match in plain text nodes with an InlineControlNode.
 * Runs on typing and on paste (Lexical runs registered transforms on dirty text
 * nodes during reconciliation), so pasted `use /web-search now` becomes a chip too.
 *
 * Handles all matches within a single node in one pass; remaining text becomes a
 * new dirty node that re-runs the transform, so arbitrarily long pastes converge.
 */
export const ReplacePlugin: React.FC<ReplacePluginProps> = ({
  name,
  pattern,
  contentRender,
  createData,
}) => {
  const [editor] = useLexicalComposerContext();
  useRegisterRenderer(name, contentRender);

  useEffect(() => {
    const removeTransform = editor.registerNodeTransform(TextNode, textNode => {
      if (!$isTextNode(textNode) || !textNode.isSimpleText()) return;

      let node: TextNode | null = textNode;
      while (node) {
        const text = node.getTextContent();
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        if (!match || match[0].length === 0) return;

        const start = match.index;
        const end = start + match[0].length;

        let target: TextNode;
        let rest: TextNode | null;
        if (start === 0) {
          const parts = node.splitText(end);
          target = parts[0];
          rest = parts[1] ?? null;
        } else {
          const parts = node.splitText(start, end);
          target = parts[1];
          rest = parts[2] ?? null;
        }

        const control = $createInlineControlNode({
          kind: name,
          text: match[0],
          data: createData?.(match),
        });
        target.replace(control);
        node = rest;
      }
    });
    return removeTransform;
  }, [editor, name, pattern, createData]);

  return null;
};
