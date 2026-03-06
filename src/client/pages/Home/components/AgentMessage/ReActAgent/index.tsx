import HumanInputForm from '@/client/components/HumanInputForm';
import MarkdownRender from '@/client/components/MarkdownRender';
import { SchemaProperty } from '@/client/components/SchemaField';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type {
  MessageRenderState,
  ThoughtItem,
  ToolCallTimeline,
} from '@/shared/utils/deriveMessageState';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Collapse, Flex, Steps, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';
import './index.scss';

type AwaitingInputData = {
  message: string;
  schema: SchemaProperty;
};

interface ProgressData {
  status?: string;
  message?: string;
  schema?: SchemaProperty;
  [key: string]: unknown;
}

type AnalysisAction = 'meta_extract' | 'chunk' | 'embed' | 'archive';

interface AnalysisProgressData {
  action: AnalysisAction;
  message: string;
}

const ANALYSIS_PIPELINE_STEPS: Array<{
  action: AnalysisAction;
  label: string;
}> = [
  { action: 'meta_extract', label: 'Metadata' },
  { action: 'chunk', label: 'Chunking' },
  { action: 'embed', label: 'Embedding' },
  { action: 'archive', label: 'Archive' },
];

interface ToolBlock {
  toolCall: ToolCallTimeline;
  latestProgress: ProgressData | null;
  isPending: boolean;
}

interface ReActDerivedState {
  toolBlocks: ToolBlock[];
  /** Standalone thoughts (e.g., before final_answer) */
  standaloneThoughts: ThoughtItem[];
  awaitingInput: AwaitingInputData | null;
  isProcessing: boolean;
  showBubbleLoading: boolean;
  shouldExpandDetails: boolean;
}

function deriveReActState(state: MessageRenderState): ReActDerivedState {
  const { toolCallTimeline, thoughts, isTerminated, hasContent, hasEvents } =
    state;

  const toolBlocks: ToolBlock[] = toolCallTimeline.map(toolCall => {
    const latestProgress = toolCall.progress.at(-1)?.data as
      | ProgressData
      | undefined;
    return {
      toolCall,
      latestProgress: latestProgress ?? null,
      isPending: toolCall.status === 'pending',
    };
  });

  const lastToolCall = toolBlocks.at(-1);
  const lastProgress = lastToolCall?.latestProgress;

  const awaitingInput =
    lastToolCall?.isPending &&
    lastToolCall?.toolCall.toolName === ToolIds.HUMAN_IN_THE_LOOP &&
    lastProgress?.status === 'awaiting_input'
      ? { message: lastProgress.message!, schema: lastProgress.schema! }
      : null;

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

function getToolColor(toolName: string): string {
  return TAG_COLORS[hashString(toolName) % TAG_COLORS.length];
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

function AnalysisPipeline({
  progress,
  isPending,
}: {
  progress: Array<{ data: unknown; seq: number; at: number }>;
  isPending: boolean;
}) {
  const progressByAction = new Map<AnalysisAction, string>();

  for (const p of progress) {
    const data = p.data as AnalysisProgressData;
    if (data?.action && data?.message) {
      progressByAction.set(data.action, data.message);
    }
  }

  const currentActionIndex = ANALYSIS_PIPELINE_STEPS.findIndex(
    step => !progressByAction.has(step.action),
  );
  const activeStep = currentActionIndex === -1 ? 3 : currentActionIndex;

  return (
    <div className="analysis-pipeline">
      <Steps
        size="small"
        current={isPending ? activeStep : 3}
        items={ANALYSIS_PIPELINE_STEPS.map(step => {
          const message = progressByAction.get(step.action);
          const isComplete = progressByAction.has(step.action);
          const isCurrent =
            isPending && activeStep === ANALYSIS_PIPELINE_STEPS.indexOf(step);

          return {
            title: step.label,
            status: isPending
              ? isCurrent
                ? 'process'
                : isComplete
                  ? 'finish'
                  : 'wait'
              : 'finish',
            description: message && (
              <Typography.Text
                type="secondary"
                className="analysis-pipeline-step-message"
              >
                {message}
              </Typography.Text>
            ),
          };
        })}
      />
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

  const isAnalysisTool = toolCall.toolName === ToolIds.ANALYSIS;
  const hasAnalysisProgress =
    isAnalysisTool &&
    toolCall.progress.some(p => {
      const data = p.data as AnalysisProgressData;
      return data?.action;
    });

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

      {hasAnalysisProgress ? (
        <AnalysisPipeline progress={toolCall.progress} isPending={isPending} />
      ) : (
        latestProgress?.message &&
        !latestProgress?.status && (
          <Typography.Text type="secondary" className="react-tool-progress">
            {latestProgress.message}
          </Typography.Text>
        )
      )}

      {toolCall.status === 'done' && toolCall.output ? (
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
      ) : null}

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

const ReActAgentRenderer = (
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

registerAgentRenderer(AgentIds.REACT, ReActAgentRenderer);
registerAgentRenderer(AgentIds.DOCUMENT, ReActAgentRenderer);

export default ReActAgentRenderer;
