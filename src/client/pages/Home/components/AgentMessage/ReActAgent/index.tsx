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
import { LoadingOutlined } from '@ant-design/icons';
import type { StepsProps } from 'antd';
import { Collapse, Flex, Steps, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';

type AwaitingInputData = {
  message: string;
  schema: SchemaProperty;
};

interface ReActDerivedState {
  steps: NonNullable<StepsProps['items']>;
  awaitingInput: AwaitingInputData | null;
  isProcessing: boolean;
  showBubbleLoading: boolean;
  shouldExpandDetails: boolean;
}

function deriveReActState(state: MessageRenderState): ReActDerivedState {
  const { toolCallTimeline, thoughts, isTerminated, hasContent, hasEvents } =
    state;

  const lastToolCall = toolCallTimeline.at(-1);
  const lastProgress = lastToolCall?.progress.at(-1)?.data as
    | { status?: string; message?: string; schema?: SchemaProperty }
    | undefined;

  const awaitingInput =
    lastToolCall?.status === 'pending' &&
    lastToolCall?.toolName === ToolIds.HUMAN_IN_THE_LOOP &&
    lastProgress?.status === 'awaiting_input'
      ? { message: lastProgress.message!, schema: lastProgress.schema! }
      : null;

  const allToolsSettled =
    toolCallTimeline.length > 0 &&
    toolCallTimeline.every(t => t.status !== 'pending');

  const isProcessing =
    hasEvents && !isTerminated && !awaitingInput && allToolsSettled;

  const steps: NonNullable<StepsProps['items']> = [
    ...thoughts.map(thoughtStep),
    ...toolCallTimeline.map(toolCallStep),
  ];

  if (isProcessing) {
    steps.push({
      title: (
        <Typography.Text type="secondary" italic>
          Processing...
        </Typography.Text>
      ),
      status: 'process',
    });
  }

  return {
    steps,
    awaitingInput,
    isProcessing,
    showBubbleLoading: !hasContent && !hasEvents && !isTerminated,
    shouldExpandDetails: !isTerminated && steps.length > 0,
  };
}

function thoughtStep(
  thought: ThoughtItem,
): NonNullable<StepsProps['items']>[0] {
  return {
    title: 'Thinking',
    description: (
      <Typography.Paragraph
        type="secondary"
        italic
        ellipsis={{ rows: 2, expandable: 'collapsible' }}
      >
        {thought.content}
      </Typography.Paragraph>
    ),
    status: 'finish',
  };
}

function toolCallStep(
  toolCall: ToolCallTimeline,
): NonNullable<StepsProps['items']>[0] {
  const at = (
    <Tag color="lime">{dayjs(toolCall.at).format('YYYY-MM-DD HH:mm:ss')}</Tag>
  );

  return {
    title: (
      <Flex align="center">
        Tool <Tag color="orange">{toolCall.toolName}</Tag>
        {at}
      </Flex>
    ),
    status:
      toolCall.status === 'pending'
        ? 'process'
        : toolCall.status === 'done'
          ? 'finish'
          : toolCall.status,
    description: (
      <Typography.Text type="secondary" italic>
        {JSON.stringify(toolCall.toolArgs)}
      </Typography.Text>
    ),
    ...(toolCall.status === 'done' && toolCall.output
      ? {
          content: (
            <Typography.Paragraph
              type="secondary"
              copyable
              ellipsis={{ rows: 3, expandable: 'collapsible' }}
            >
              {typeof toolCall.output === 'string'
                ? toolCall.output
                : JSON.stringify(toolCall.output)}
            </Typography.Paragraph>
          ),
        }
      : {}),
    ...(toolCall.status === 'error'
      ? {
          content: (
            <Typography.Paragraph
              type="danger"
              ellipsis={{ rows: 2, expandable: 'collapsible' }}
            >
              {toolCall.error}
            </Typography.Paragraph>
          ),
        }
      : {}),
  };
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

  if (derived.steps.length === 0) {
    return null;
  }

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
                Process Details
              </Typography.Text>
            ),
            children: (
              <Steps
                size="small"
                orientation="vertical"
                current={derived.steps.length}
                items={derived.steps}
              />
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

export default ReActAgentRenderer;
