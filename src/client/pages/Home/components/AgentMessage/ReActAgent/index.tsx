import HumanInputForm from '@/client/components/HumanInputForm';
import MarkdownRender from '@/client/components/MarkdownRender';
import { AgentIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type { MessageRenderState, ThoughtItem } from '../deriveMessageState';
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
  detectAwaitingInput,
  getToolColor,
  type ToolBlock,
} from '../utils';
import './index.scss';

interface ReActDerivedState {
  toolBlocks: ToolBlock[];
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
                {derived.toolBlocks.map(block => (
                  <ToolBlockItem key={block.toolCall.callId} block={block} />
                ))}
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

          <MarkdownRender>{msg.content}</MarkdownRender>
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
