import AudioPlayer from '@/client/components/AudioPlayer';
import MarkdownRender from '@/client/components/MarkdownRender';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { Message } from '@/shared/types/entities';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Flex, Spin, Tooltip, Typography } from 'antd';
import './index.scss';

interface TTSResult {
  voice: string;
  filePath: string;
}

const extractTTSInfo = (events: AgentEvent[] | undefined): TTSResult | null => {
  if (!events) return null;

  for (const event of events) {
    if (
      event.type === 'tool_result' &&
      event.toolName === ToolIds.TEXT_TO_SPEECH
    ) {
      try {
        return typeof event.output === 'string'
          ? (JSON.parse(event.output) as TTSResult)
          : (event.output as TTSResult);
      } catch {
        return null;
      }
    }
  }
  return null;
};

const GirFriendAgentMessage = ({ msg }: { msg: Message }) => {
  const ttsInfo = extractTTSInfo(msg.meta?.events as AgentEvent[] | undefined);

  return (
    <Flex vertical align="start">
      <Spin spinning={!ttsInfo && (msg.meta?.loading || msg.meta?.streaming)}>
        <MarkdownRender>{msg.content}</MarkdownRender>
      </Spin>
      {ttsInfo && (
        <AudioPlayer
          src={`/api/files/play/${ttsInfo.filePath}`}
          className="gf-meta-audio"
          suffix={
            <Tooltip
              classNames={{ root: 'gf-meta-tooltip' }}
              title={
                <Typography.Text copyable>{ttsInfo.filePath}</Typography.Text>
              }
            >
              <InfoCircleOutlined className="gf-meta-icon" />
            </Tooltip>
          }
        />
      )}
    </Flex>
  );
};

export default GirFriendAgentMessage;
