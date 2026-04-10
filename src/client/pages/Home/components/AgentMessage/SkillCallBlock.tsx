import { CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Button, Flex, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { lazy, useState } from 'react';
import type { ToolCallTimeline } from '@/client/store/modules/MessageFSM';
import Modal from '@/client/components/Modal';
import './ReActAgent/index.scss';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

export interface SkillCallBlockProps {
  toolCall: ToolCallTimeline;
  depth?: number;
}

export function SkillCallBlock({
  toolCall,
  depth = 0,
}: SkillCallBlockProps): React.ReactElement {
  const [modalOpen, setModalOpen] = useState(false);

  const skillId = (toolCall.toolArgs?.skillId as string) ?? 'unknown';
  const isPending = toolCall.status === 'pending';

  const Icon = isPending ? (
    <SyncOutlined spin style={{ color: 'var(--ant-color-primary)' }} />
  ) : toolCall.status === 'done' ? (
    <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
  ) : (
    <span style={{ color: 'var(--ant-color-error)' }}>✕</span>
  );

  const skillContent =
    toolCall.status === 'done' && toolCall.output
      ? typeof toolCall.output === 'string'
        ? toolCall.output
        : ((toolCall.output as { content?: string })?.content ?? '')
      : '';

  return (
    <div
      className={`react-tool-block ${depth > 0 ? `nested-depth-${depth}` : ''}`}
    >
      <Flex align="center" gap={8} className="react-tool-header">
        {Icon}
        <Tag color="geekblue">skill</Tag>
        <Typography.Text>{skillId}</Typography.Text>
        <Typography.Text type="secondary" className="react-tool-time">
          {dayjs(toolCall.at).format('HH:mm:ss')}
        </Typography.Text>
        {!isPending && skillContent && (
          <Button size="small" type="link" onClick={() => setModalOpen(true)}>
            查看技能详情
          </Button>
        )}
      </Flex>

      {toolCall.status === 'error' && (
        <Typography.Text type="danger" className="react-tool-error">
          {toolCall.error}
        </Typography.Text>
      )}

      <Modal
        title={`技能: ${skillId}`}
        open={modalOpen}
        onOk={() => setModalOpen(false)}
        onCancel={() => setModalOpen(false)}
        width={640}
        footer={null}
      >
        {skillContent && <MarkdownRender>{skillContent}</MarkdownRender>}
      </Modal>
    </div>
  );
}
