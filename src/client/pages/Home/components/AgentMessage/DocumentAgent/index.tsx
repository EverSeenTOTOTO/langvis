import HumanInputForm from '@/client/components/HumanInputForm';
import MarkdownRender from '@/client/components/MarkdownRender';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type { MessageRenderState, ThoughtItem } from '../deriveMessageState';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Collapse, Flex, Progress, Steps, Tag, Typography } from 'antd';
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
import '../ReActAgent/index.scss';

// === Document Agent specific: Analysis Pipeline ===

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

// === Document Agent specific: Batch Archive Progress ===

interface BatchArchiveProgressData {
  current: number;
  total: number;
  url: string;
  status: 'processing' | 'success' | 'failed';
  documentId?: string;
  title?: string;
  error?: string;
}

function BatchArchiveProgress({
  progress,
  isPending,
  nestedAnalysisProgress,
}: {
  progress: Array<{ data: unknown; seq: number; at: number }>;
  isPending: boolean;
  nestedAnalysisProgress?: Array<{ data: unknown; seq: number; at: number }>;
}) {
  // Get the latest progress for each URL
  const urlStatusMap = new Map<string, BatchArchiveProgressData>();

  for (const p of progress) {
    const data = p.data as BatchArchiveProgressData;
    if (data?.url) {
      urlStatusMap.set(data.url, data);
    }
  }

  // Calculate overall progress
  const completed = Array.from(urlStatusMap.values()).filter(
    d => d.status === 'success' || d.status === 'failed',
  ).length;

  const latestProgress = Array.from(urlStatusMap.values()).pop();
  const total = latestProgress?.total ?? progress.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const failedList = Array.from(urlStatusMap.values()).filter(
    d => d.status === 'failed',
  );
  const failed = failedList.length;

  // Get current processing URL and its analysis step
  const processingUrl =
    latestProgress?.status === 'processing' ? latestProgress.url : null;

  // Get current analysis step message from nested progress
  const currentStep = nestedAnalysisProgress
    ? (() => {
        const progressByAction = new Map<AnalysisAction, string>();
        for (const p of nestedAnalysisProgress) {
          const data = p.data as AnalysisProgressData;
          if (data?.action && data?.message) {
            progressByAction.set(data.action, data.message);
          }
        }
        // Find the first incomplete step
        for (const step of ANALYSIS_PIPELINE_STEPS) {
          if (!progressByAction.has(step.action)) {
            // Return the previous step's message (the one currently running)
            const prevIndex = ANALYSIS_PIPELINE_STEPS.indexOf(step) - 1;
            if (prevIndex >= 0) {
              return progressByAction.get(
                ANALYSIS_PIPELINE_STEPS[prevIndex].action,
              );
            }
            return null;
          }
        }
        return null;
      })()
    : null;

  return (
    <div className="batch-archive-progress">
      <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
        <Progress
          percent={percent}
          size="small"
          status={isPending ? 'active' : failed > 0 ? 'exception' : 'success'}
          style={{ flex: 1 }}
        />
        <Typography.Text type="secondary">
          {completed}/{total}
        </Typography.Text>
      </Flex>

      {/* Show processing URL with current step */}
      {isPending && processingUrl && (
        <div style={{ marginBottom: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Processing: {processingUrl}
          </Typography.Text>
          {currentStep && (
            <Typography.Text
              type="secondary"
              style={{ fontSize: 11, marginLeft: 8 }}
            >
              ({currentStep})
            </Typography.Text>
          )}
        </div>
      )}

      {!isPending && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {completed - failed} succeeded, {failed} failed
        </Typography.Text>
      )}

      {/* Show failed URLs */}
      {!isPending && failedList.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {failedList.map(item => (
            <div key={item.url} style={{ marginBottom: 4 }}>
              <CloseCircleOutlined
                style={{ color: 'var(--ant-color-error)', marginRight: 4 }}
              />
              <Typography.Link
                href={item.url}
                target="_blank"
                ellipsis
                style={{ fontSize: 11, maxWidth: 200 }}
              >
                {item.url}
              </Typography.Link>
              {item.error && (
                <Typography.Text
                  type="danger"
                  style={{ fontSize: 11, marginLeft: 4 }}
                >
                  ({item.error})
                </Typography.Text>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// === State derivation ===

interface DocumentDerivedState {
  toolBlocks: ToolBlock[];
  standaloneThoughts: ThoughtItem[];
  awaitingInput: ReturnType<typeof detectAwaitingInput>;
  isProcessing: boolean;
  showBubbleLoading: boolean;
  shouldExpandDetails: boolean;
}

function deriveDocumentState(state: MessageRenderState): DocumentDerivedState {
  const { toolCallTimeline, thoughts, isTerminated, hasContent, hasEvents } =
    state;

  const toolBlocks = buildToolBlocks(toolCallTimeline);

  // Fix: Check ALL pending tools for awaiting_input
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

// === Sub-components ===

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
    <CloseCircleOutlined style={{ color: 'var(--ant-color-error)' }} />
  ) : null;

  // Document Agent specific: Analysis pipeline visualization
  const isAnalysisTool = toolCall.toolName === ToolIds.ANALYSIS;
  const hasAnalysisProgress =
    isAnalysisTool &&
    toolCall.progress.some(p => {
      const data = p.data as AnalysisProgressData;
      return data?.action;
    });

  // Document Agent specific: Batch archive progress visualization
  const isBatchArchiveTool = toolCall.toolName === ToolIds.BATCH_ARCHIVE;
  const hasBatchArchiveProgress =
    isBatchArchiveTool &&
    toolCall.progress.some(p => {
      const data = p.data as BatchArchiveProgressData;
      return data?.url;
    });

  // Extract nested analysis_tool progress from batch_archive_tool progress
  // (since nested tools share the same callId, filter by 'action' field)
  const nestedAnalysisProgress = isBatchArchiveTool
    ? toolCall.progress.filter(p => {
        const data = p.data as { action?: string };
        return data?.action;
      })
    : undefined;

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
      ) : hasBatchArchiveProgress ? (
        <BatchArchiveProgress
          progress={toolCall.progress}
          isPending={isPending}
          nestedAnalysisProgress={nestedAnalysisProgress}
        />
      ) : (
        latestProgress?.message &&
        !latestProgress?.status && (
          <Typography.Text type="secondary" className="react-tool-progress">
            {latestProgress.message}
          </Typography.Text>
        )
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

// === Main renderer ===

interface DocumentEventRendererProps {
  state: MessageRenderState;
  conversationId: string;
}

const DocumentEventRenderer: React.FC<DocumentEventRendererProps> = ({
  state,
  conversationId,
}) => {
  const derived = deriveDocumentState(state);
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

const DocumentAgentRenderer = (
  msg: Message,
  state: MessageRenderState,
): AgentRenderResult => {
  const { showBubbleLoading } = deriveDocumentState(state);

  return {
    content: (
      <>
        {state.hasEvents && (
          <DocumentEventRenderer
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

registerAgentRenderer(AgentIds.DOCUMENT, DocumentAgentRenderer);

export default DocumentAgentRenderer;
