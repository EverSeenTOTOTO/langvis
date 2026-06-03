import AudioPlayer from '@/client/components/AudioPlayer';
import { lazy, Suspense } from 'react';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));
import { TextToSpeechOutput } from '@/server/modules/agent/implementations/tools/TextToSpeech';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { MessageNode } from '@/client/store/modules/message-node';
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

function deriveGirlFriendState(node: MessageNode): GirlFriendDerivedState {
  const ttsCall = node.toolCalls.find(
    t => t.toolName === ToolIds.TEXT_TO_SPEECH,
  );

  const isTtsPending = ttsCall?.status === 'pending';
  const ttsError = ttsCall?.status === 'failed' ? ttsCall.error : undefined;
  const ttsOutput =
    ttsCall?.status === 'completed'
      ? (ttsCall.output as TextToSpeechOutput | undefined)
      : undefined;

  const isProcessing =
    node.hasContent &&
    !node.isTerminal &&
    !isTtsPending &&
    !ttsOutput &&
    !ttsError;

  return { isTtsPending, ttsError, ttsOutput, isProcessing };
}

const GirlFriendAgentRenderer = (node: MessageNode): AgentRenderResult => {
  const derived = deriveGirlFriendState(node);

  return {
    content: (
      <>
        {node.isThinking && (
          <Typography.Text type="secondary" italic>
            <LoadingOutlined style={{ marginInlineEnd: 4 }} />
            Thinking...
          </Typography.Text>
        )}
        <Spin spinning={derived.isTtsPending}>
          <Suspense
            fallback={
              <Typography.Paragraph>{node.content}</Typography.Paragraph>
            }
          >
            <MarkdownRender>{node.content}</MarkdownRender>
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
