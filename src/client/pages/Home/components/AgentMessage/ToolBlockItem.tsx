import { CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Flex, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import type React from 'react';
import type {
  ToolCallTimeline,
  ThoughtItem,
} from '@/client/store/modules/MessageFSM';
import './ReActAgent/index.scss';

const TAG_COLORS = [
  'magenta',
  'red',
  'volcano',
  'orange',
  'gold',
  'lime',
  'green',
  'cyan',
  'blue',
  'geekblue',
  'purple',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getToolColor(toolName: string): string {
  return TAG_COLORS[hashString(toolName) % TAG_COLORS.length];
}

export interface ToolBlockItemProps {
  toolCall: ToolCallTimeline;
  /** Nesting depth for visual indentation */
  depth?: number;
  /** Custom render function for tool-specific visualization */
  customRender?: (toolCall: ToolCallTimeline) => React.ReactNode;
}

/**
 * Renders a single tool call with status, progress, and output.
 * Used by both top-level renderers and nested agent call blocks.
 */
export function ToolBlockItem({
  toolCall,
  depth = 0,
  customRender,
}: ToolBlockItemProps): React.ReactElement {
  const color = getToolColor(toolCall.toolName);
  const isPending = toolCall.status === 'pending';

  const streamingChunks = useMemo(() => {
    const chunks: { type: 'stdout' | 'stderr'; text: string }[] = [];
    for (const p of toolCall.progress) {
      const d = p.data as { type?: string; text?: string } | undefined;
      if (d?.type === 'stdout' && d.text)
        chunks.push({ type: 'stdout', text: d.text });
      else if (d?.type === 'stderr' && d.text)
        chunks.push({ type: 'stderr', text: d.text });
    }
    return chunks;
  }, [toolCall.progress]);

  const latestProgress = toolCall.progress.at(-1)?.data as
    | { status?: string; message?: string }
    | undefined;

  const Icon = isPending ? (
    <SyncOutlined spin style={{ color: 'var(--ant-color-primary)' }} />
  ) : toolCall.status === 'done' ? (
    <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
  ) : (
    <span style={{ color: 'var(--ant-color-error)' }}>✕</span>
  );

  // Allow custom rendering for specific tools
  if (customRender) {
    const custom = customRender(toolCall);
    if (custom) return <>{custom}</>;
  }

  return (
    <div
      className={`react-tool-block ${depth > 0 ? `nested-depth-${depth}` : ''}`}
    >
      {toolCall.thought && (
        <div className="react-tool-thought">
          <Typography.Paragraph
            type="secondary"
            italic
            ellipsis={{ rows: 2, expandable: 'collapsible' }}
          >
            💭 {toolCall.thought}
          </Typography.Paragraph>
        </div>
      )}

      <Flex align="center" gap={8} className="react-tool-header">
        {Icon}
        <Tag color={color}>{toolCall.toolName}</Tag>
        <Typography.Text type="secondary" className="react-tool-time">
          {dayjs(toolCall.at).format('HH:mm:ss')}
        </Typography.Text>
      </Flex>

      {latestProgress?.message && !latestProgress?.status && (
        <Typography.Text type="secondary" className="react-tool-progress">
          {latestProgress.message}
        </Typography.Text>
      )}

      {streamingChunks.length > 0 && (
        <div className="react-tool-streaming-output">
          {streamingChunks.map((chunk, i) => (
            <pre
              key={i}
              className={chunk.type === 'stderr' ? 'stream-stderr' : ''}
            >
              {chunk.text}
            </pre>
          ))}
          {isPending && <span className="stream-cursor" />}
        </div>
      )}

      {toolCall.status === 'done' && toolCall.output !== undefined && (
        <div className="react-tool-output">
          <Typography.Paragraph
            type="secondary"
            copyable
            ellipsis={{ rows: 2, expandable: 'collapsible' }}
          >
            {typeof toolCall.output === 'string'
              ? toolCall.output
              : JSON.stringify(toolCall.output, null, 2)}
          </Typography.Paragraph>
        </div>
      )}

      {toolCall.status === 'error' && (
        <Typography.Text type="danger" className="react-tool-error">
          {toolCall.error}
        </Typography.Text>
      )}
    </div>
  );
}

export interface StandaloneThoughtBlockProps {
  thought: ThoughtItem;
}

export function StandaloneThoughtBlock({
  thought,
}: StandaloneThoughtBlockProps): React.ReactElement {
  return (
    <div className="react-thought-block">
      <Flex align="center" gap={8} className="react-tool-header">
        <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
        <Tag color="blue">Thought</Tag>
        <Typography.Text type="secondary" className="react-tool-time">
          {dayjs(thought.at).format('HH:mm:ss')}
        </Typography.Text>
      </Flex>
      <Typography.Paragraph
        type="secondary"
        italic
        ellipsis={{ rows: 2, expandable: 'collapsible' }}
        className="react-thought-content"
      >
        {thought.content}
      </Typography.Paragraph>
    </div>
  );
}
