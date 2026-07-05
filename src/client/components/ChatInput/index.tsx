import {
  CloseOutlined,
  LoadingOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { mergeRegister } from '@lexical/utils';
import { Button } from 'antd';
import clsx from 'clsx';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  COMMAND_PRIORITY_LOW,
  EditorState,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from 'lexical';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  $isInlineControlNode,
  InlineControlNode,
  InlineControlRegistryProvider,
} from './plugins';
import './index.scss';

export interface ChatInputProps {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  loading?: boolean;
  cancelling?: boolean;
  placeholder?: string;
  header?: React.ReactNode;
  /** Content rendered before the send button */
  suffix?: React.ReactNode;
  /** Lexical plugins rendered inside the composer (e.g. ReplacePlugin/PopoverPlugin). */
  children?: React.ReactNode;
  minRows?: number;
  maxRows?: number;
  className?: string;
}

const theme = {
  paragraph: 'chat-input-paragraph',
};

const InnerEditor: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  loading?: boolean;
  cancelling?: boolean;
  placeholder?: string;
  suffix?: React.ReactNode;
  children?: React.ReactNode;
  minRows?: number;
  maxRows?: number;
}> = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  loading,
  cancelling,
  placeholder,
  suffix,
  children,
  minRows = 2,
  maxRows = 6,
}) => {
  const [editor] = useLexicalComposerContext();
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const lineHeight = useRef<number>(22);
  const isExternalChange = useRef(false);

  useEffect(() => {
    if (contentEditableRef.current) {
      const computed = window.getComputedStyle(contentEditableRef.current);
      lineHeight.current = parseFloat(computed.lineHeight) || 22;
    }
  }, []);

  useEffect(() => {
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const currentText = root.getTextContent();
      if (currentText !== value) {
        isExternalChange.current = true;
        editor.update(() => {
          const editorRoot = $getRoot();
          editorRoot.clear();
          const paragraph = $createParagraphNode();
          if (value) {
            paragraph.append($createTextNode(value));
          }
          editorRoot.append(paragraph);
        });
      }
    });
  }, [editor, value]);

  // Delete selected inline-control chips as a unit on Backspace/Delete.
  useEffect(() => {
    const deleteSelectedControls = (event: KeyboardEvent) => {
      const selection = $getSelection();
      if (!$isNodeSelection(selection)) return false;
      const controls = selection.getNodes().filter($isInlineControlNode);
      if (controls.length === 0) return false;
      event.preventDefault();
      controls.forEach(node => node.remove());
      return true;
    };
    return mergeRegister(
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        deleteSelectedControls,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        deleteSelectedControls,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  const handleChange = useCallback(
    (editorState: EditorState) => {
      // 当外部 value prop 变化时，编辑器会同步更新内容，这会触发 OnChangePlugin。
      // 使用 isExternalChange 标记跳过此次 onChange 回调，避免无限循环：
      // 外部 value 变化 → 编辑器更新 → OnChangePlugin 触发 → onChange 回调 → 父组件 setState → value 变化 → ...
      if (isExternalChange.current) {
        isExternalChange.current = false;
        return;
      }
      editorState.read(() => {
        const root = $getRoot();
        const text = root.getTextContent();
        onChange?.(text);
      });
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!loading && value?.trim()) {
          onSubmit?.();
        }
      }
    },
    [loading, onSubmit],
  );

  const handleCancel = useCallback(() => {
    if (loading && !cancelling) {
      onCancel?.();
    }
  }, [loading, cancelling, onCancel]);

  const handleSend = useCallback(() => {
    if (!loading && value?.trim()) {
      onSubmit?.();
    }
  }, [loading, value, onSubmit]);

  const calculateHeight = useCallback(() => {
    if (!contentEditableRef.current) return;

    const lines = (value || '').split('\n').length;
    const clampedLines = Math.min(Math.max(lines, minRows), maxRows);
    const height = clampedLines * lineHeight.current + 24;
    contentEditableRef.current.style.height = `${height}px`;
  }, [value, minRows, maxRows]);

  useEffect(() => {
    calculateHeight();
  }, [calculateHeight]);

  return (
    <div className="chat-input-wrapper">
      <div className="chat-input-editor-container">
        <div className="chat-input-editor-inner" onKeyDown={handleKeyDown}>
          <PlainTextPlugin
            contentEditable={
              <ContentEditable className="chat-input-content-editable" />
            }
            placeholder={
              <div className="chat-input-placeholder">{placeholder}</div>
            }
            ErrorBoundary={({ children: errorChildren }) => (
              <>{errorChildren}</>
            )}
          />
          <HistoryPlugin />
          <OnChangePlugin onChange={handleChange} />
          {children}
        </div>
        <div className="chat-input-actions">
          {suffix}
          <Button
            type="primary"
            className="chat-input-send-button"
            icon={
              cancelling ? (
                <CloseOutlined />
              ) : loading ? (
                <LoadingOutlined spin />
              ) : (
                <SendOutlined />
              )
            }
            onClick={loading && !cancelling ? handleCancel : handleSend}
            disabled={cancelling || (!loading && !value?.trim())}
            loading={false}
          />
        </div>
      </div>
    </div>
  );
};

const ChatInput: React.FC<ChatInputProps> = ({
  value = '',
  onChange,
  onSubmit,
  onCancel,
  loading = false,
  cancelling = false,
  placeholder = 'Type a message...',
  header,
  suffix,
  children,
  minRows = 2,
  maxRows = 6,
  className,
}) => {
  const initialConfig = {
    namespace: 'ChatInput',
    theme,
    nodes: [InlineControlNode],
    onError: (error: Error) => {
      console.error(error);
    },
  };

  return (
    <div className={clsx('chat-input-container', className)}>
      {header && <div className="chat-input-header">{header}</div>}
      <LexicalComposer initialConfig={initialConfig}>
        <InlineControlRegistryProvider>
          <InnerEditor
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            onCancel={onCancel}
            loading={loading}
            cancelling={cancelling}
            placeholder={placeholder}
            suffix={suffix}
            minRows={minRows}
            maxRows={maxRows}
          >
            {children}
          </InnerEditor>
        </InlineControlRegistryProvider>
      </LexicalComposer>
    </div>
  );
};

export default ChatInput;
