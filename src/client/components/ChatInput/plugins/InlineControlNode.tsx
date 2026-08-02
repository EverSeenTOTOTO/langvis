import type {
  EditorConfig,
  LexicalEditor,
  NodeKey,
  SerializedLexicalNode,
} from 'lexical';
import { $applyNodeReplacement, DecoratorNode } from 'lexical';
import type { ReactNode } from 'react';
import { InlineControlHost } from './InlineControlRegistry';

export interface SerializedInlineControlNode extends SerializedLexicalNode {
  kind: string;
  text: string;
  data?: unknown;
}

export interface InlineControlNodeOptions {
  kind: string;
  text: string;
  data?: unknown;
  key?: NodeKey;
}

// One DecoratorNode shared by every inline-control plugin; rendering defers to the registry `kind`.
export class InlineControlNode extends DecoratorNode<ReactNode> {
  __kind: string;
  __text: string;
  __data: unknown;

  static getType(): string {
    return 'inline-control';
  }

  static clone(node: InlineControlNode): InlineControlNode {
    return new InlineControlNode(
      node.__kind,
      node.__text,
      node.__data,
      node.__key,
    );
  }

  static importJSON(json: SerializedInlineControlNode): InlineControlNode {
    return $createInlineControlNode({
      kind: json.kind,
      text: json.text,
      data: json.data,
    });
  }

  constructor(kind: string, text: string, data?: unknown, key?: NodeKey) {
    super(key);
    this.__kind = kind;
    this.__text = text;
    this.__data = data;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.className = 'chat-input-inline-control';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  getTextContent(): string {
    return this.__text;
  }

  exportJSON(): SerializedInlineControlNode {
    return {
      type: 'inline-control',
      version: 1,
      kind: this.__kind,
      text: this.__text,
      data: this.__data,
    };
  }

  decorate(editor: LexicalEditor): ReactNode {
    return (
      <InlineControlHost
        nodeKey={this.getKey()}
        kind={this.__kind}
        text={this.__text}
        data={this.__data}
        editor={editor}
      />
    );
  }
}

export function $createInlineControlNode(
  options: InlineControlNodeOptions,
): InlineControlNode {
  return $applyNodeReplacement(
    new InlineControlNode(
      options.kind,
      options.text,
      options.data,
      options.key,
    ),
  );
}

export function $isInlineControlNode(node: unknown): node is InlineControlNode {
  return node instanceof InlineControlNode;
}
