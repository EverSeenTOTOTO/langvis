import AudioPlayer from '@/client/components/AudioPlayer';
import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { TextToSpeechOutput } from '@/server/core/tool/TextToSpeech';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { MessageFSM } from '@/client/store/modules/MessageFSM';
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

function deriveGirlFriendState(fsm: MessageFSM): GirlFriendDerivedState {
  const ttsCall = fsm.toolCallTimeline.find(
    t => t.toolName === ToolIds.TEXT_TO_SPEECH,
  );

  const isTtsPending = ttsCall?.status === 'pending';
  const ttsError = ttsCall?.status === 'error' ? ttsCall.error : undefined;
  const ttsOutput =
    ttsCall?.status === 'done'
      ? (ttsCall.output as TextToSpeechOutput | undefined)
      : undefined;

  const isProcessing =
    fsm.hasContent &&
    !fsm.isTerminated &&
    !isTtsPending &&
    !ttsOutput &&
    !ttsError;

  return { isTtsPending, ttsError, ttsOutput, isProcessing };
}

const GirlFriendAgentRenderer = (fsm: MessageFSM): AgentRenderResult => {
  const derived = deriveGirlFriendState(fsm);

  return {
    content: (
      <>
        {fsm.isThinking && (
          <Typography.Text type="secondary" italic>
            <LoadingOutlined style={{ marginInlineEnd: 4 }} />
            Thinking...
          </Typography.Text>
        )}
        <Spin spinning={derived.isTtsPending}>
          <Suspense
            fallback={
              <Typography.Paragraph>{fsm.msg.content}</Typography.Paragraph>
            }
          >
            <MarkdownRender>{fsm.msg.content}</MarkdownRender>
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
