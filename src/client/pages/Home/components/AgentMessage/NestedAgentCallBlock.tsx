import {
  CaretDownOutlined,
  CaretLeftOutlined,
  CheckCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Flex, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { ToolCallTimeline } from '@/client/store/modules/MessageFSM';
import { ToolBlockItem, getToolColor } from './ToolBlockItem';
import { buildToolTimeline, extractNestedEvents } from './utils';
import './ReActAgent/index.scss';

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
  const [expanded, setExpanded] = useState(depth === 0);

  // Extract nested events from this agent_call's progress
  const nestedEvents = extractNestedEvents(toolCall.progress);
  const nestedTimeline = buildToolTimeline(nestedEvents);

  // Get agentId from toolArgs
  const agentId = toolCall.toolArgs?.agentId as string | undefined;

  const Icon =
    toolCall.status === 'pending' ? (
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
        <Typography.Text type="secondary" style={{ marginLeft: 'auto' }}>
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
