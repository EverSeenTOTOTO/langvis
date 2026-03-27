import AudioPlayer from '@/client/components/AudioPlayer';
import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { TextToSpeechOutput } from '@/server/core/tool/TextToSpeech';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type { MessageRenderState } from '../deriveMessageState';
import { InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { Alert, Spin, Tooltip, Typography } from 'antd';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';
import './index.scss';

interface GirlFriendDerivedState {
  isTtsPending: boolean;
  ttsError: string | undefined;
  ttsOutput: TextToSpeechOutput | undefined;
  isProcessing: boolean;
}

function deriveGirlFriendState(
  state: MessageRenderState,
): GirlFriendDerivedState {
  const ttsCall = state.toolCallTimeline.find(
    t => t.toolName === ToolIds.TEXT_TO_SPEECH,
  );

  const isTtsPending = ttsCall?.status === 'pending';
  const ttsError = ttsCall?.status === 'error' ? ttsCall.error : undefined;
  const ttsOutput =
    ttsCall?.status === 'done'
      ? (ttsCall.output as TextToSpeechOutput | undefined)
      : undefined;

  const isProcessing =
    state.hasContent &&
    !state.isTerminated &&
    !isTtsPending &&
    !ttsOutput &&
    !ttsError;

  return { isTtsPending, ttsError, ttsOutput, isProcessing };
}

const GirlFriendAgentRenderer = (
  msg: Message,
  state: MessageRenderState,
): AgentRenderResult => {
  const derived = deriveGirlFriendState(state);

  return {
    content: (
      <>
        {state.isAwaitingContent && (
          <Typography.Text type="secondary" italic>
            <LoadingOutlined style={{ marginInlineEnd: 4 }} />
            Thinking...
          </Typography.Text>
        )}
        <Spin spinning={derived.isTtsPending}>
          <Suspense
            fallback={
              <Typography.Paragraph>{msg.content}</Typography.Paragraph>
            }
          >
            <MarkdownRender>{msg.content}</MarkdownRender>
          </Suspense>
        </Spin>
        {derived.isProcessing && (
          <Typography.Text type="secondary" italic>
            <LoadingOutlined style={{ marginInlineEnd: 4 }} />
            Generating voice...
          </Typography.Text>
        )}
        {derived.ttsOutput && (
          <AudioPlayer
            src={`/api/files/play/${derived.ttsOutput.filePath}`}
            className="gf-meta-audio"
            suffix={
              <Tooltip
                classNames={{ root: 'gf-meta-tooltip' }}
                title={
                  <Typography.Text copyable>
                    {derived.ttsOutput.filePath}
                  </Typography.Text>
                }
              >
                <InfoCircleOutlined className="gf-meta-icon" />
              </Tooltip>
            }
          />
        )}
        {derived.ttsError && (
          <Alert
            type="error"
            title={derived.ttsError}
            style={{ marginBlockEnd: 8 }}
          />
        )}
      </>
    ),
  };
};

registerAgentRenderer(AgentIds.GIRLFRIEND, GirlFriendAgentRenderer);

export default GirlFriendAgentRenderer;
