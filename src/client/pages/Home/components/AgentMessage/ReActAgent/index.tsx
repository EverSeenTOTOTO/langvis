import HumanInputForm from '@/client/components/HumanInputForm';
import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { AgentIds } from '@/shared/constants';
import type { AgentEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import type {
  MessageRenderState,
  ThoughtItem,
  ToolCallTimeline,
} from '../deriveMessageState';
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
import {
  buildToolBlocks,
  buildAgentCallBlocks,
  detectAwaitingInput,
  detectAwaitingInputInEvents,
  getToolColor,
  type ToolBlock,
  type AgentCallBlock,
} from '../utils';
import './index.scss';

interface ReActDerivedState {
  toolBlocks: ToolBlock[];
  agentCallBlocks: AgentCallBlock[];
  standaloneThoughts: ThoughtItem[];
  awaitingInput: ReturnType<typeof detectAwaitingInput>;
  isProcessing: boolean;
  showBubbleLoading: boolean;
  shouldExpandDetails: boolean;
}

function deriveReActState(state: MessageRenderState): ReActDerivedState {
  const { toolCallTimeline, thoughts, isTerminated, hasContent, hasEvents } =
    state;

  const toolBlocks = buildToolBlocks(toolCallTimeline);
  const agentCallBlocks = buildAgentCallBlocks(toolCallTimeline);

  const awaitingInput = detectAwaitingInput(toolBlocks);

  const allToolsSettled =
    toolBlocks.length > 0 && toolBlocks.every(b => !b.isPending);

  const isProcessing =
    hasEvents &&
    !isTerminated &&
    !awaitingInput &&
    !allToolsSettled &&
    !hasContent;

  return {
    toolBlocks,
    agentCallBlocks,
    standaloneThoughts: thoughts,
    awaitingInput,
    isProcessing,
    showBubbleLoading: !hasContent && !hasEvents && !isTerminated,
    shouldExpandDetails:
      !isTerminated && (toolBlocks.length > 0 || thoughts.length > 0),
  };
}

function StandaloneThoughtBlock({ thought }: { thought: ThoughtItem }) {
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

/**
 * Build tool call timeline from nested agent events
 */
function buildNestedToolTimeline(events: AgentEvent[]): ToolCallTimeline[] {
  const toolCallsMap = new Map<string, ToolCallTimeline>();

  for (const event of events) {
    switch (event.type) {
      case 'tool_call':
        toolCallsMap.set(event.callId, {
          callId: event.callId,
          toolName: event.toolName,
          toolArgs: event.toolArgs,
          seq: event.seq,
          at: event.at,
          status: 'pending',
          progress: [],
        });
        break;

      case 'tool_result': {
        const existing = toolCallsMap.get(event.callId);
        if (existing) {
          existing.status = 'done';
          existing.output = event.output;
        }
        break;
      }

      case 'tool_error': {
        const existing = toolCallsMap.get(event.callId);
        if (existing) {
          existing.status = 'error';
          existing.error = event.error;
        }
        break;
      }

      case 'tool_progress': {
        const existing = toolCallsMap.get(event.callId);
        if (existing) {
          existing.progress.push({
            data: event.data,
            seq: event.seq,
            at: event.at,
          });
        }
        break;
      }
    }
  }

  return Array.from(toolCallsMap.values()).sort((a, b) => a.seq - b.seq);
}

interface AgentCallBlockItemProps {
  block: AgentCallBlock;
  conversationId: string;
}

function AgentCallBlockItem({
  block,
  conversationId,
}: AgentCallBlockItemProps) {
  const [expanded, setExpanded] = useState(false);
  const nestedToolTimeline = buildNestedToolTimeline(block.events);
  const nestedToolBlocks = buildToolBlocks(nestedToolTimeline);
  const nestedAwaitingInput = detectAwaitingInputInEvents(block.events);

  const Icon =
    block.status === 'pending' ? (
      <SyncOutlined spin style={{ color: 'var(--ant-color-primary)' }} />
    ) : block.status === 'done' ? (
      <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
    ) : (
      <span style={{ color: 'var(--ant-color-error)' }}>✕</span>
    );

  return (
    <div className="react-agent-call-block">
      <Flex
        align="center"
        gap={8}
        className="react-agent-call-header"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        {Icon}
        <Tag color="purple">Agent</Tag>
        <Typography.Text type="secondary">
          {nestedToolTimeline.length} tool(s)
        </Typography.Text>
        <Typography.Text type="secondary" style={{ marginLeft: 'auto' }}>
          {expanded ? '▼' : '▶'}
        </Typography.Text>
      </Flex>

      {expanded && nestedToolBlocks.length > 0 && (
        <div className="react-agent-call-nested">
          {nestedToolBlocks.map(toolBlock => (
            <ToolBlockItem key={toolBlock.toolCall.callId} block={toolBlock} />
          ))}
        </div>
      )}

      {expanded && nestedAwaitingInput && (
        <div className="react-agent-call-input">
          <HumanInputForm
            conversationId={conversationId}
            message={nestedAwaitingInput.message}
            schema={nestedAwaitingInput.schema}
          />
        </div>
      )}

      {block.status === 'error' && (
        <Typography.Text type="danger" className="react-tool-error">
          {block.error}
        </Typography.Text>
      )}
    </div>
  );
}

function ToolBlockItem({ block }: { block: ToolBlock }) {
  const { toolCall, latestProgress, isPending } = block;
  const color = getToolColor(toolCall.toolName);

  const Icon = isPending ? (
    <SyncOutlined spin style={{ color: 'var(--ant-color-primary)' }} />
  ) : toolCall.status === 'done' ? (
    <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
  ) : toolCall.status === 'error' ? (
    <span style={{ color: 'var(--ant-color-error)' }}>✕</span>
  ) : null;

  return (
    <div className="react-tool-block">
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

interface ReActEventRendererProps {
  state: MessageRenderState;
  conversationId: string;
}

const ReActEventRenderer: React.FC<ReActEventRendererProps> = ({
  state,
  conversationId,
}) => {
  const derived = deriveReActState(state);
  const [activeKey, setActiveKey] = useState<string[]>([]);

  useEffect(() => {
    setActiveKey(derived.shouldExpandDetails ? ['1'] : []);
  }, [derived.shouldExpandDetails]);

  if (
    derived.toolBlocks.length === 0 &&
    derived.standaloneThoughts.length === 0
  ) {
    return null;
  }

  const totalItems =
    derived.toolBlocks.length + derived.standaloneThoughts.length;

  return (
    <>
      <Collapse
        size="small"
        activeKey={activeKey}
        onChange={keys => setActiveKey(keys as string[])}
        items={[
          {
            key: '1',
            label: (
              <Typography.Text type="secondary">
                Process Details ({totalItems} steps)
              </Typography.Text>
            ),
            children: (
              <div className="react-tool-list">
                {derived.toolBlocks.map(block => {
                  // Use AgentCallBlockItem for agent_call tools
                  if (block.toolCall.toolName === 'agent_call') {
                    const agentCallBlock = derived.agentCallBlocks.find(
                      b => b.callId === block.toolCall.callId,
                    );
                    if (agentCallBlock) {
                      return (
                        <AgentCallBlockItem
                          key={agentCallBlock.callId}
                          block={agentCallBlock}
                          conversationId={conversationId}
                        />
                      );
                    }
                  }
                  return (
                    <ToolBlockItem key={block.toolCall.callId} block={block} />
                  );
                })}
                {derived.standaloneThoughts.map(thought => (
                  <StandaloneThoughtBlock
                    key={`thought-${thought.seq}`}
                    thought={thought}
                  />
                ))}
                {derived.isProcessing && (
                  <div className="react-tool-processing">
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
      {derived.awaitingInput && (
        <HumanInputForm
          conversationId={conversationId}
          message={derived.awaitingInput.message}
          schema={derived.awaitingInput.schema}
        />
      )}
    </>
  );
};

const createReActRenderer = (agentId: string) => {
  const renderer = (
    msg: Message,
    state: MessageRenderState,
  ): AgentRenderResult => {
    const { showBubbleLoading } = deriveReActState(state);

    return {
      content: (
        <>
          {state.hasEvents && (
            <ReActEventRenderer
              state={state}
              conversationId={msg.conversationId}
            />
          )}

          {state.isAwaitingContent && (
            <Typography.Text type="secondary" italic>
              <LoadingOutlined style={{ marginInlineEnd: 4 }} />
              Thinking...
            </Typography.Text>
          )}

          <Suspense
            fallback={
              <Typography.Paragraph>{msg.content}</Typography.Paragraph>
            }
          >
            <MarkdownRender>{msg.content}</MarkdownRender>
          </Suspense>
        </>
      ),
      showBubbleLoading,
    };
  };

  registerAgentRenderer(agentId, renderer);
  return renderer;
};

const ReActAgentRenderer = createReActRenderer(AgentIds.REACT);

export { createReActRenderer };
export default ReActAgentRenderer;
