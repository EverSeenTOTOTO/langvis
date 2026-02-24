import AudioPlayer from '@/client/components/AudioPlayer';
import MarkdownRender from '@/client/components/MarkdownRender';
import { TextToSpeechOutput } from '@/server/core/tool/TextToSpeech';
import { ToolIds } from '@/shared/constants';
import { Message } from '@/shared/types/entities';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Alert, Spin, Tooltip, Typography } from 'antd';
import './index.scss';

interface AgentRenderResult {
  content: React.ReactNode;
  isLoading: boolean;
}

const GirlFriendAgentMessage = ({
  msg,
}: {
  msg: Message;
}): AgentRenderResult => {
  let ttsCall, ttsResult, ttsError;

  for (const e of msg.meta?.events || []) {
    if (e.type === 'tool_call' && e.toolName === ToolIds.TEXT_TO_SPEECH) {
      ttsCall = e;
    }
    if (e.type === 'tool_result' && e.toolName === ToolIds.TEXT_TO_SPEECH) {
      ttsResult = e;
    }
    if (e.type === 'tool_error' && e.toolName === ToolIds.TEXT_TO_SPEECH) {
      ttsError = e;
    }
  }

  const output = ttsResult?.output as TextToSpeechOutput | undefined;
  const hasFinalOrError = msg.meta?.events?.some(e =>
    ['final', 'error'].includes(e.type),
  );

  return {
    content: (
      <>
        <Spin spinning={!!ttsCall && !(ttsResult || ttsError)}>
          <MarkdownRender>{msg.content}</MarkdownRender>
        </Spin>
        {ttsResult && (
          <AudioPlayer
            src={`/api/files/play/${output?.filePath}`}
            className="gf-meta-audio"
            suffix={
              <Tooltip
                classNames={{ root: 'gf-meta-tooltip' }}
                title={
                  <Typography.Text copyable>{output?.filePath}</Typography.Text>
                }
              >
                <InfoCircleOutlined className="gf-meta-icon" />
              </Tooltip>
            }
          />
        )}
        {ttsError && (
          <Alert
            type="error"
            title={ttsError.error}
            style={{ marginBlockEnd: 8 }}
          />
        )}
      </>
    ),
    isLoading: msg.content.length === 0 && !ttsResult && !hasFinalOrError,
  };
};

export default GirlFriendAgentMessage;
