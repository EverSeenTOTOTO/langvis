import AudioPlayer from '@/client/components/AudioPlayer';
import MarkdownRender from '@/client/components/MarkdownRender';
import { TextToSpeechOutput } from '@/server/core/tool/TextToSpeech';
import { ToolIds, AgentIds } from '@/shared/constants';
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
  // Find TTS tool calls - get last one for rendering
  const ttsCalls = state.toolCallTimeline.filter(
    t => t.toolName === ToolIds.TEXT_TO_SPEECH,
  );
  const lastTts = ttsCalls.at(-1);

  // Determine TTS state
  const isTtsPending = lastTts?.status === 'pending';
  const ttsError = lastTts?.status === 'error' ? lastTts.error : undefined;
  const ttsOutput =
    lastTts?.status === 'done'
      ? (lastTts.output as TextToSpeechOutput | undefined)
      : undefined;

  const showBubbleLoading =
    !state.hasContent && !state.hasPendingTools && !state.isTerminal;

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
