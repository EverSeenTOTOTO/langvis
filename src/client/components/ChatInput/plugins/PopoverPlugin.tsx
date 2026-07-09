import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  KEY_ESCAPE_COMMAND,
  type RangeSelection,
} from 'lexical';
import { Popover } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaretCoords, PopoverPluginProps } from './types';
import { useTriggerQuery, type TriggerMatch } from './useTriggerQuery';

/** Read the caret rect from the live DOM selection (viewport coordinates). */
const readCaretCoords = (fallback: CaretCoords): CaretCoords => {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rect = range.getBoundingClientRect();
    if (rect.left !== 0 || rect.top !== 0) {
      return { left: rect.left, top: rect.top, bottom: rect.bottom };
    }
  }
  return fallback;
};

/**
 * Opens a popover anchored to the caret when a trigger character is typed.
 *
 * Rendering reuses antd `Popover` (rc-popover) for styling and automatic
 * flip/shift near viewport edges. The anchor element's caret rect is snapshotted
 * at open time and kept stable for the session — rc-trigger does not track a
 * moving trigger, so a stable anchor (captured where `/` was typed) is required;
 * rc-trigger still re-aligns when the popup body changes size (list filtering).
 *
 * - swallow=false (default): the trigger is inserted; text typed after it is
 *   tracked and passed to `popoverRender` as `query`.
 * - swallow=true: the trigger character is intercepted (not inserted) and the
 *   popover opens with an empty query.
 */
export const PopoverPlugin: React.FC<PopoverPluginProps> = ({
  trigger,
  popoverRender,
  swallow = false,
  minLength = 1,
  requireBoundary = false,
}) => {
  const [editor] = useLexicalComposerContext();
  const triggers = Array.isArray(trigger) ? trigger : [trigger];
  const triggerQuery = useTriggerQuery(trigger, { minLength, requireBoundary });

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [anchorCoords, setAnchorCoords] = useState<CaretCoords>({
    left: 0,
    top: 0,
    bottom: 0,
  });
  const openRef = useRef(false);

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  // Track an active trigger at the caret (swallow=false path).
  useEffect(() => {
    if (swallow) return;
    return editor.registerUpdateListener(({ editorState }) => {
      const match = editorState.read<TriggerMatch | null>(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed())
          return null;
        const anchor = (selection as RangeSelection).anchor;
        if (anchor.type !== 'text') return null;
        const node = $getNodeByKey(anchor.key);
        if (!$isTextNode(node)) return null;
        const textBeforeCaret = node.getTextContent().slice(0, anchor.offset);
        return triggerQuery(textBeforeCaret);
      });

      if (!match) {
        close();
        return;
      }
      // Snapshot the caret rect once when the popover opens; keep it stable
      // afterwards so rc-trigger's anchor does not need position tracking.
      if (!openRef.current) {
        openRef.current = true;
        setAnchorCoords(readCaretCoords(anchorCoords));
      }
      setQuery(match.matchingString);
      setOpen(true);
    });
  }, [editor, swallow, triggerQuery, close, anchorCoords]);

  // Intercept the trigger character so it is never inserted (swallow=true path).
  useEffect(() => {
    if (!swallow) return;
    return editor.registerCommand(
      CONTROLLED_TEXT_INSERTION_COMMAND,
      (payload: InputEvent | string) => {
        const text =
          typeof payload === 'string' ? payload : (payload.data ?? '');
        if (triggers.includes(text)) {
          openRef.current = true;
          setOpen(true);
          setQuery('');
          setAnchorCoords(readCaretCoords(anchorCoords));
          return true; // swallow — prevent insertion
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [swallow, editor, triggers, anchorCoords]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        close();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, open, close]);

  // Close on scroll (the snapshot anchor would go stale) and on click-outside.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      // Ignore the popup's own list scroll — only external scrolls (page/chat)
      // make the snapshot caret anchor stale and warrant closing.
      const target = e.target as Element | null;
      if (target && target.closest?.('.ant-popover')) return;
      close();
    };
    const onDocMouseDown = (e: MouseEvent) => {
      const root = editor.getRootElement();
      const target = e.target as Element | null;
      if (target && root && root.contains(target)) return;
      if (target && target.closest?.('.ant-popover')) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onDocMouseDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [open, editor, close]);

  return (
    <Popover
      open={open}
      placement="bottomLeft"
      trigger={[]}
      showArrow={false}
      destroyOnHidden
      content={popoverRender({ query, close, editor, caret: anchorCoords })}
      styles={{
        container: { padding: 4, maxHeight: 280, overflow: 'auto' },
      }}
      getPopupContainer={() => document.body}
    >
      {/* Invisible stable anchor at the snapshot caret rect. rc-trigger aligns
          the popup to this element; antd autoAdjustOverflow flips it on overflow. */}
      <span
        aria-hidden
        style={{
          position: 'fixed',
          left: anchorCoords.left,
          top: anchorCoords.top,
          width: 1,
          height: Math.max(anchorCoords.bottom - anchorCoords.top, 0),
          pointerEvents: 'none',
        }}
      />
    </Popover>
  );
};
