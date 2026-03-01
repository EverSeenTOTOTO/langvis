import AudioPlayer from '@/client/components/AudioPlayer';
import MarkdownRender from '@/client/components/MarkdownRender';
import { TextToSpeechOutput } from '@/server/core/tool/TextToSpeech';
import { AgentIds, ToolIds } from '@/shared/constants';
import type { Message } from '@/shared/types/entities';
import type { MessageRenderState } from '@/shared/utils/deriveMessageState';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Alert, Spin, Tooltip, Typography } from 'antd';
import {
  registerAgentRenderer,
  type AgentRenderResult,
} from '../../agentRenderers';
import './index.scss';

const GirlFriendAgentRenderer = (
  msg: Message,
  state: MessageRenderState,
): AgentRenderResult => {
  const ttsCall = state.toolCallTimeline.find(
    t => t.toolName === ToolIds.TEXT_TO_SPEECH,
  );

  // Determine TTS state
  const isTtsPending = ttsCall?.status === 'pending';
  const ttsError = ttsCall?.status === 'error' ? ttsCall.error : undefined;
  const ttsOutput =
    ttsCall?.status === 'done'
      ? (ttsCall.output as TextToSpeechOutput | undefined)
      : undefined;

  const showBubbleLoading =
    !state.hasContent && !state.hasPendingTools && !state.isTerminated;

  return {
    content: (
      <>
        <Spin spinning={isTtsPending}>
          <MarkdownRender>{msg.content}</MarkdownRender>
        </Spin>
        {ttsOutput && (
          <AudioPlayer
            src={`/api/files/play/${ttsOutput.filePath}`}
            className="gf-meta-audio"
            suffix={
              <Tooltip
                classNames={{ root: 'gf-meta-tooltip' }}
                title={
                  <Typography.Text copyable>
                    {ttsOutput.filePath}
                  </Typography.Text>
                }
              >
                <InfoCircleOutlined className="gf-meta-icon" />
              </Tooltip>
            }
          />
        )}
        {ttsError && (
          <Alert type="error" title={ttsError} style={{ marginBlockEnd: 8 }} />
        )}
      </>
    ),
    showBubbleLoading,
  };
};

// Register renderer
registerAgentRenderer(AgentIds.GIRLFRIEND, GirlFriendAgentRenderer);

export default GirlFriendAgentRenderer;
