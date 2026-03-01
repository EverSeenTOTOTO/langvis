import MarkdownRender from '@/client/components/MarkdownRender';
import HumanInputForm from '@/client/components/HumanInputForm';
import { SchemaProperty } from '@/client/components/SchemaField';
import { ToolIds, AgentIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type { MessageRenderState } from '@/shared/utils/deriveMessageState';
import { Collapse, Flex, Steps, Tag, Typography } from 'antd';
import type { StepsProps } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';

interface ReActEventRendererProps {
  state: MessageRenderState;
  conversationId: string;
}

const ReActEventRenderer: React.FC<ReActEventRendererProps> = ({
  state,
  conversationId,
}) => {
  const { toolCallTimeline, thoughts, isTerminated } = state;
  const [activeKey, setActiveKey] = useState<string[]>([]);

  useEffect(() => {
    if (isTerminated) {
      setActiveKey([]);
    } else if (toolCallTimeline.length > 0 || thoughts.length > 0) {
      setActiveKey(['1']);
    }
  }, [toolCallTimeline.length, thoughts.length, isTerminated]);

  // Check for awaiting input state
  const lastToolCall = toolCallTimeline.at(-1);
  const lastProgressData = lastToolCall?.progress.at(-1)?.data as
    | { status?: string; message?: string; schema?: SchemaProperty }
    | undefined;

  const awaitingInputData =
    lastToolCall?.status === 'pending' &&
    lastToolCall?.toolName === ToolIds.HUMAN_IN_THE_LOOP &&
    lastProgressData?.status === 'awaiting_input'
      ? { message: lastProgressData.message!, schema: lastProgressData.schema! }
      : null;

  // Build steps from timeline
  const steps: StepsProps['items'] = [];

  // Add thoughts first
  for (const thought of thoughts) {
    steps.push({
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
    });
  }

  // Add tool calls
  for (const toolCall of toolCallTimeline) {
    const at = (
      <Tag color="lime">{dayjs(toolCall.at).format('YYYY-MM-DD HH:mm:ss')}</Tag>
    );

    steps.push({
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
    });
  }

  if (steps.length === 0) {
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
                current={steps.length}
                items={steps}
              />
            ),
          },
        ]}
        style={{ width: '100%', marginBlock: 8 }}
      />
      {awaitingInputData && (
        <HumanInputForm
          conversationId={conversationId}
          message={awaitingInputData.message}
          schema={awaitingInputData.schema}
        />
      )}
    </>
  );
};

const ReActAgentRenderer = (
  msg: Message,
  state: MessageRenderState,
): AgentRenderResult => {
  const showBubbleLoading =
    !state.hasContent && !state.hasEvents && !state.isTerminated;

  return {
    content: (
      <>
        {state.hasEvents && (
          <ReActEventRenderer
            state={state}
            conversationId={msg.conversationId}
          />
        )}
        <MarkdownRender>{msg.content}</MarkdownRender>
      </>
    ),
    showBubbleLoading,
  };
};

// Register renderer
registerAgentRenderer(AgentIds.REACT, ReActAgentRenderer);

export default ReActAgentRenderer;
