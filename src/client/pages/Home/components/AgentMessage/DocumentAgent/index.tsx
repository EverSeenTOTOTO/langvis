import MarkdownRender from '@/client/components/MarkdownRender';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type { ToolCallTimeline } from '@/shared/utils/deriveMessageState';
import type { MessageRenderState } from '@/shared/utils/deriveMessageState';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Collapse, Flex, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';
import './index.scss';

interface ProgressData {
  action?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface ToolBlock {
  toolCall: ToolCallTimeline;
  latestProgress: ProgressData | null;
  isPending: boolean;
}

interface DocumentDerivedState {
  toolBlocks: ToolBlock[];
  showBubbleLoading: boolean;
  isProcessing: boolean;
  shouldExpandDetails: boolean;
}

function deriveDocumentState(state: MessageRenderState): DocumentDerivedState {
  const { toolCallTimeline, isTerminated, hasContent, hasEvents } = state;

  const toolBlocks: ToolBlock[] = toolCallTimeline
    .filter(t => Object.values(ToolIds).includes(t.toolName as ToolIds))
    .map(toolCall => {
      const latestProgress = toolCall.progress.at(-1)?.data as
        | ProgressData
        | undefined;
      return {
        toolCall,
        latestProgress: latestProgress ?? null,
        isPending: toolCall.status === 'pending',
      };
    });

  const allToolsSettled =
    toolBlocks.length > 0 && toolBlocks.every(b => !b.isPending);

  const isProcessing =
    hasEvents && !isTerminated && !allToolsSettled && !hasContent;

  return {
    toolBlocks,
    showBubbleLoading: !hasContent && !hasEvents && !isTerminated,
    isProcessing,
    shouldExpandDetails: !isTerminated && toolBlocks.length > 0,
  };
}

function getToolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    [ToolIds.ANALYSIS]: 'Analysis',
    [ToolIds.META_EXTRACT]: 'Metadata Extraction',
    [ToolIds.CHUNK]: 'Content Chunking',
    [ToolIds.EMBED]: 'Embedding',
    [ToolIds.ARCHIVE]: 'Archive',
    [ToolIds.RETRIEVE]: 'Retrieve',
    [ToolIds.HUMAN_IN_THE_LOOP]: 'Human Input',
    [ToolIds.LLM_CALL]: 'LLM Call',
    [ToolIds.WEB_FETCH]: 'Web Fetch',
  };
  return names[toolName] ?? toolName;
}

function getToolColor(toolName: string): string {
  const colors: Record<string, string> = {
    [ToolIds.ANALYSIS]: 'purple',
    [ToolIds.META_EXTRACT]: 'geekblue',
    [ToolIds.CHUNK]: 'cyan',
    [ToolIds.EMBED]: 'blue',
    [ToolIds.ARCHIVE]: 'green',
    [ToolIds.RETRIEVE]: 'orange',
    [ToolIds.HUMAN_IN_THE_LOOP]: 'gold',
    [ToolIds.LLM_CALL]: 'magenta',
    [ToolIds.WEB_FETCH]: 'lime',
  };
  return colors[toolName] ?? 'default';
}

function ToolBlockItem({ block }: { block: ToolBlock }) {
  const { toolCall, latestProgress, isPending } = block;
  const displayName = getToolDisplayName(toolCall.toolName);
  const color = getToolColor(toolCall.toolName);

  const Icon = isPending ? (
    <SyncOutlined spin style={{ color: 'var(--ant-color-primary)' }} />
  ) : toolCall.status === 'done' ? (
    <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
  ) : toolCall.status === 'error' ? (
    <span style={{ color: 'var(--ant-color-error)' }}>✕</span>
  ) : null;

  return (
    <div className="doc-tool-block">
      <Flex align="center" gap={8} className="doc-tool-header">
        {Icon}
        <Tag color={color}>{displayName}</Tag>
        <Typography.Text type="secondary" className="doc-tool-time">
          {dayjs(toolCall.at).format('HH:mm:ss')}
        </Typography.Text>
      </Flex>

      {latestProgress?.message && (
        <Typography.Text type="secondary" className="doc-tool-progress">
          {latestProgress.message}
        </Typography.Text>
      )}

      {toolCall.status === 'done' && toolCall.output ? (
        <div className="doc-tool-output">
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
      ) : null}

      {toolCall.status === 'error' && (
        <Typography.Text type="danger" className="doc-tool-error">
          {toolCall.error}
        </Typography.Text>
      )}
    </div>
  );
}

interface DocumentEventRendererProps {
  state: MessageRenderState;
}

const DocumentEventRenderer: React.FC<DocumentEventRendererProps> = ({
  state,
}) => {
  const derived = deriveDocumentState(state);
  const [activeKey, setActiveKey] = useState<string[]>([]);

  useEffect(() => {
    setActiveKey(derived.shouldExpandDetails ? ['1'] : []);
  }, [derived.shouldExpandDetails]);

  if (derived.toolBlocks.length === 0) {
    return null;
  }

  return (
    <Collapse
      size="small"
      activeKey={activeKey}
      onChange={keys => setActiveKey(keys as string[])}
      items={[
        {
          key: '1',
          label: (
            <Typography.Text type="secondary">
              Process Details ({derived.toolBlocks.length} tools)
            </Typography.Text>
          ),
          children: (
            <div className="doc-tool-list">
              {derived.toolBlocks.map(block => (
                <ToolBlockItem key={block.toolCall.callId} block={block} />
              ))}
              {derived.isProcessing && (
                <div className="doc-tool-processing">
                  <LoadingOutlined style={{ marginInlineEnd: 8 }} />
                  <Typography.Text type="secondary" italic>
                    Processing...
                  </Typography.Text>
                </div>
              )}
            </div>
          ),
        },
      ]}
      style={{ width: '100%', marginBlock: 8 }}
    />
  );
};

const DocumentAgentRenderer = (
  msg: Message,
  state: MessageRenderState,
): AgentRenderResult => {
  const derived = deriveDocumentState(state);

  return {
    content: (
      <>
        {state.hasEvents && <DocumentEventRenderer state={state} />}

        {state.isAwaitingContent && (
          <Typography.Text type="secondary" italic>
            <LoadingOutlined style={{ marginInlineEnd: 4 }} />
            Thinking...
          </Typography.Text>
        )}

        <MarkdownRender>{msg.content}</MarkdownRender>
      </>
    ),
    showBubbleLoading: derived.showBubbleLoading,
  };
};

registerAgentRenderer(AgentIds.DOCUMENT, DocumentAgentRenderer);

export default DocumentAgentRenderer;
