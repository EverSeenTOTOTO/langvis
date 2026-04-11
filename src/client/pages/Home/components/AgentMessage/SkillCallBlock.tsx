import { CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Button, Flex, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { lazy, Suspense } from 'react';
import type { ToolCallTimeline } from '@/client/store/modules/MessageFSM';
import Modal from '@/client/components/Modal';
import './ReActAgent/index.scss';
import { useStore } from '@/client/store';
import type { SkillCallOutput } from '@/server/core/tool/SkillCall/config';
import { safeJsonParse } from '@/shared/utils';
import { getToolColor } from './ToolBlockItem';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

export interface SkillCallBlockProps {
  toolCall: ToolCallTimeline;
  depth?: number;
}

export function SkillCallBlock({
  toolCall,
  depth = 0,
}: SkillCallBlockProps): React.ReactElement {
  const settingStore = useStore('setting');

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
    (toolCall.status === 'done' &&
      safeJsonParse<SkillCallOutput>(toolCall.output)?.content) ||
    (toolCall.output as string);

  return (
    <div
      className={`react-skill-block ${depth > 0 ? `nested-depth-${depth}` : ''}`}
    >
      <Flex align="center" gap={8} className="react-tool-header">
        {Icon}
        <Tag color="cyan">Skill</Tag>
        <Tag color={getToolColor(skillId)}>{skillId}</Tag>
        <Typography.Text type="secondary" className="react-tool-time">
          {dayjs(toolCall.at).format('HH:mm:ss')}
        </Typography.Text>
        {!isPending && (
          <Modal
            title={`技能: ${skillId}`}
            width="75%"
            footer={false}
            trigger={
              <Button size="small" type="link">
                {settingStore.tr('View')}
              </Button>
            }
          >
            <Suspense
              fallback={
                <Typography.Paragraph>{skillContent}</Typography.Paragraph>
              }
            >
              <MarkdownRender>{skillContent}</MarkdownRender>
            </Suspense>
          </Modal>
        )}
      </Flex>

      {toolCall.status === 'error' && (
        <Typography.Text type="danger" className="react-tool-error">
          {toolCall.error}
        </Typography.Text>
      )}
    </div>
  );
}
