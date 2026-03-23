import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { ToolIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type {
  MessageRenderState,
  ToolCallTimeline,
} from '../deriveMessageState';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Flex, Progress, Steps, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';
import { UniversalEventRenderer } from '../UniversalEventRenderer';
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
  const urlStatusMap = new Map<string, BatchArchiveProgressData>();

  for (const p of progress) {
    const data = p.data as BatchArchiveProgressData;
    if (data?.url) {
      urlStatusMap.set(data.url, data);
    }
  }

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

  const processingUrl =
    latestProgress?.status === 'processing' ? latestProgress.url : null;

  const currentStep = nestedAnalysisProgress
    ? (() => {
        const progressByAction = new Map<AnalysisAction, string>();
        for (const p of nestedAnalysisProgress) {
          const data = p.data as AnalysisProgressData;
          if (data?.action && data?.message) {
            progressByAction.set(data.action, data.message);
          }
        }
        for (const step of ANALYSIS_PIPELINE_STEPS) {
          if (!progressByAction.has(step.action)) {
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

// === Custom tool render for Document Agent ===

function renderDocumentTool(toolCall: ToolCallTimeline): React.ReactNode {
  const isAnalysisTool = toolCall.toolName === ToolIds.DOCUMENT_ARCHIVE;
  const hasAnalysisProgress =
    isAnalysisTool &&
    toolCall.progress.some(p => {
      const data = p.data as AnalysisProgressData;
      return data?.action;
    });

  const isBatchArchiveTool =
    toolCall.toolName === ToolIds.DOCUMENT_ARCHIVE_BATCH;
  const hasBatchArchiveProgress =
    isBatchArchiveTool &&
    toolCall.progress.some(p => {
      const data = p.data as BatchArchiveProgressData;
      return data?.url;
    });

  const nestedAnalysisProgress = isBatchArchiveTool
    ? toolCall.progress.filter(p => {
        const data = p.data as { action?: string };
        return data?.action;
      })
    : undefined;

  const isPending = toolCall.status === 'pending';
  const color = (() => {
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
    let hash = 0;
    for (let i = 0; i < toolCall.toolName.length; i++) {
      hash = ((hash << 5) - hash + toolCall.toolName.charCodeAt(i)) | 0;
    }
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
  })();

  const Icon = isPending ? (
    <SyncOutlined spin style={{ color: 'var(--ant-color-primary)' }} />
  ) : toolCall.status === 'done' ? (
    <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
  ) : (
    <CloseCircleOutlined style={{ color: 'var(--ant-color-error)' }} />
  );

  if (hasAnalysisProgress) {
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
        <AnalysisPipeline progress={toolCall.progress} isPending={isPending} />
      </div>
    );
  }

  if (hasBatchArchiveProgress) {
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
        <BatchArchiveProgress
          progress={toolCall.progress}
          isPending={isPending}
          nestedAnalysisProgress={nestedAnalysisProgress}
        />
      </div>
    );
  }

  // Return null to use default rendering
  return null;
}

// === Document Agent Renderer ===

const DocumentAgentRenderer = (
  msg: Message,
  state: MessageRenderState,
): AgentRenderResult => {
  const showBubbleLoading =
    !state.hasContent && !state.hasPendingTools && !state.isTerminated;

  return {
    content: (
      <>
        {state.hasEvents && (
          <UniversalEventRenderer
            state={state}
            conversationId={msg.conversationId}
            customToolRender={renderDocumentTool}
          />
        )}

        {state.isAwaitingContent && (
          <Typography.Text type="secondary" italic>
            <LoadingOutlined style={{ marginInlineEnd: 4 }} />
            Thinking...
          </Typography.Text>
        )}

        <Suspense
          fallback={<Typography.Paragraph>{msg.content}</Typography.Paragraph>}
        >
          <MarkdownRender>{msg.content}</MarkdownRender>
        </Suspense>
      </>
    ),
    showBubbleLoading,
  };
};

registerAgentRenderer('document', DocumentAgentRenderer);

export default DocumentAgentRenderer;
