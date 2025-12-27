import AudioPlayer from '@/client/components/AudioPlayer';
import MarkdownRender from '@/client/components/MarkdownRender';
import { Message } from '@/shared/entities/Message';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Flex, Spin, Tooltip, Typography } from 'antd';
import './index.scss';

const GirFriendAgentMessage = ({
  msg,
}: {
  msg: Message<{
    filePath?: string;
    voice?: string;
  }>;
}) => {
  return (
    <Flex vertical align="start">
      <Spin spinning={!msg.meta?.filePath}>
        <MarkdownRender>{msg.content}</MarkdownRender>
      </Spin>
      {msg.meta?.filePath && (
        <AudioPlayer
          src={`/api/files/play/${msg.meta.filePath}`}
          className="gf-meta-audio"
          suffix={
            <Tooltip
              trigger="click"
              classNames={{ root: 'gf-meta-tooltip' }}
              title={
                <Typography.Text copyable>{msg.meta.filePath}</Typography.Text>
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
