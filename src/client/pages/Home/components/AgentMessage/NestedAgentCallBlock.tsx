import {
  CaretDownOutlined,
  CaretLeftOutlined,
  CheckCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Button, Flex, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { lazy, Suspense, useState } from 'react';
import type { ToolCallTimeline } from '@/client/store/modules/MessageFSM';
import Modal from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { ToolBlockItem, getToolColor } from './ToolBlockItem';
import {
  buildToolTimeline,
  extractNestedEvents,
  type ProgressData,
} from './utils';
import './ReActAgent/index.scss';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

export interface NestedAgentCallBlockProps {
  toolCall: ToolCallTimeline;
  conversationId: string;
  /** Nesting depth for visual indentation */
  depth?: number;
  /** Custom render function for tool-specific visualization */
  customToolRender?: (toolCall: ToolCallTimeline) => React.ReactNode;
}

/**
 * Renders a nested agent_call block with recursive support.
 * Can render nested agent_call blocks inside itself.
 *
 * Note: awaiting_input is handled at the top level by UniversalEventRenderer,
 * so we don't render HumanInputForm here to avoid duplication.
 */
export function NestedAgentCallBlock({
  toolCall,
  conversationId,
  depth = 0,
  customToolRender,
}: NestedAgentCallBlockProps): React.ReactElement {
  const settingStore = useStore('setting');
  const [expanded, setExpanded] = useState(depth === 0);

  // Extract nested events from this agent_call's progress
  const nestedEvents = extractNestedEvents(toolCall.progress);
  const nestedTimeline = buildToolTimeline(nestedEvents);

  // Get agentId from toolArgs or agent_start progress
  const agentId = toolCall.toolArgs?.agentId as string | undefined;

  // Extract context/query from agent_start progress event
  const agentStartProgress = toolCall.progress.find(p => {
    const data = p.data as ProgressData;
    return data?.status === 'agent_start';
  });
  const startData = agentStartProgress?.data as ProgressData | undefined;
  const context = startData?.context as string | undefined;
  const query = startData?.query as string | undefined;
  const hasDetail = !!context || !!query;

  const isPending = toolCall.status === 'pending';

  const Icon = isPending ? (
    <SyncOutlined spin style={{ color: 'var(--ant-color-primary)' }} />
  ) : toolCall.status === 'done' ? (
    <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
  ) : (
    <span style={{ color: 'var(--ant-color-error)' }}>✕</span>
  );

  return (
    <div className={`react-agent-call-block nested-depth-${depth}`}>
      <Flex
        align="center"
        gap={8}
        className="react-agent-call-header"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        {Icon}
        <Tag color="pink">Agent</Tag>
        <Tag color={getToolColor(agentId ?? 'unknown')}>{agentId}</Tag>
        <Typography.Text type="secondary">
          {nestedTimeline.length} tool(s)
        </Typography.Text>
        <Typography.Text type="secondary" className="react-tool-time">
          {dayjs(toolCall.at).format('HH:mm:ss')}
        </Typography.Text>
        {hasDetail && (
          <Modal
            title={`Agent Detail: ${agentId ?? 'unknown'}`}
            width="75%"
            footer={false}
            trigger={
              <Button size="small" type="link" style={{ marginLeft: 'auto' }}>
                {settingStore.tr('View')}
              </Button>
            }
          >
            {context && (
              <Typography.Paragraph>
                <Typography.Text strong>Context:</Typography.Text>
                <br />
                <Suspense
                  fallback={<Typography.Text>{context}</Typography.Text>}
                >
                  <MarkdownRender>{context}</MarkdownRender>
                </Suspense>
              </Typography.Paragraph>
            )}
            {query && (
              <Typography.Paragraph>
                <Typography.Text strong>Query:</Typography.Text>
                <br />
                <Suspense fallback={<Typography.Text>{query}</Typography.Text>}>
                  <MarkdownRender>{query}</MarkdownRender>
                </Suspense>
              </Typography.Paragraph>
            )}
          </Modal>
        )}

        <Typography.Text type="secondary">
          {expanded ? <CaretDownOutlined /> : <CaretLeftOutlined />}
        </Typography.Text>
      </Flex>

      {expanded && nestedTimeline.length > 0 && (
        <div className="react-agent-call-nested">
          {nestedTimeline.map(item => {
            // Recursively render nested agent_call blocks
            if (item.toolName === 'agent_call') {
              return (
                <NestedAgentCallBlock
                  key={item.callId}
                  toolCall={item}
                  conversationId={conversationId}
                  depth={depth + 1}
                  customToolRender={customToolRender}
                />
              );
            }
            // Render regular tool blocks
            return (
              <ToolBlockItem
                key={item.callId}
                toolCall={item}
                depth={depth + 1}
                customRender={customToolRender}
              />
            );
          })}
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
