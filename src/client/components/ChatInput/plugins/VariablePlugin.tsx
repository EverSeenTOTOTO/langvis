import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
} from 'lexical';
import { useCallback } from 'react';
import { $createInlineControlNode } from './InlineControlNode';
import { PopoverPlugin } from './PopoverPlugin';
import { ReplacePlugin } from './ReplacePlugin';
import { useTriggerQuery } from './useTriggerQuery';
import type {
  PopoverRenderArgs,
  VariableInsertArgs,
  VariablePluginProps,
} from './types';

// ReplacePlugin chips + Popover picker, one shared `name`; insert() swaps trigger+query for a chip.
export const VariablePlugin: React.FC<VariablePluginProps> = ({
  name,
  trigger,
  pattern,
  popoverRender,
  contentRender,
  swallow,
  minLength,
  requireBoundary,
  createData,
}) => {
  const [editor] = useLexicalComposerContext();
  const triggerQuery = useTriggerQuery(trigger, { minLength, requireBoundary });

  const insertControl = useCallback(
    ({ text, data }: VariableInsertArgs) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const anchor = selection.anchor;
        if (anchor.type !== 'text') return;
        const node = $getNodeByKey(anchor.key);
        if (!$isTextNode(node)) return;

        const full = node.getTextContent();
        const offset = anchor.offset;
        const match = triggerQuery(full.slice(0, offset));

        let start = offset;
        let end = offset;
        if (match) {
          start = match.leadOffset;
          end = match.leadOffset + match.replaceableString.length;
        }

        const control = $createInlineControlNode({ kind: name, text, data });

        if (start < end) {
          const target =
            start === 0
              ? end === full.length
                ? node
                : node.splitText(end)[0]
              : node.splitText(start, end)[1];
          target.replace(control);
        } else if (offset === 0) {
          node.insertBefore(control);
        } else if (offset >= full.length) {
          // No match and caret at end of node: append after it (splitText would
          // return no second segment and leave the control detached).
          node.insertAfter(control);
        } else {
          node.splitText(offset)[1]?.insertBefore(control);
        }

        // Trailing space + caret after it, so typing can continue naturally.
        const trailing = $createTextNode(' ');
        control.insertAfter(trailing);
        trailing.select(1);
      });
    },
    [editor, name, triggerQuery],
  );

  const mergedPopoverRender = useCallback(
    (args: PopoverRenderArgs) =>
      popoverRender({
        ...args,
        insert: (payload: VariableInsertArgs) => {
          insertControl(payload);
          args.close();
        },
      }),
    [popoverRender, insertControl],
  );

  return (
    <>
      <ReplacePlugin
        name={name}
        pattern={pattern}
        contentRender={contentRender}
        createData={createData}
      />
      <PopoverPlugin
        trigger={trigger}
        popoverRender={mergedPopoverRender}
        swallow={swallow}
        minLength={minLength}
        requireBoundary={requireBoundary}
      />
    </>
  );
};
