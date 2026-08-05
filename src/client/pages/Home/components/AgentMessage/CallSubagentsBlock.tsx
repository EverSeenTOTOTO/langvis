import { CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Button, Flex, Tag, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import {
  aggregateSubagentChildren,
  type SubagentChildState,
  type UIToolCall,
} from '@/client/view-model/message-node';
import Modal from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { getToolColor } from './ToolBlockItem';
import { RunDetailView } from './RunDetailView';

function statusIcon(status: string): React.ReactNode {
  if (status === 'running') {
    return <SyncOutlined spin style={{ color: 'var(--ant-color-primary)' }} />;
  }
  if (status === 'completed') {
    return (
      <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
    );
  }
  return <span style={{ color: 'var(--ant-color-error)' }}>✕</span>;
}

// call_subagents 工具进度块：从 toolCall.progress 聚合各子 run 状态，渲染子 run 卡片；点 View 拉取该子 run 投影详情。
export const CallSubagentsBlock = observer(function CallSubagentsBlock({
  toolCall,
}: {
  toolCall: UIToolCall;
}): React.ReactElement {
  const settingStore = useStore('setting');

  const children: SubagentChildState[] = aggregateSubagentChildren(
    toolCall.progress,
  );

  const Icon = statusIcon(
    toolCall.status === 'pending' ? 'running' : toolCall.status,
  );

  return (
    <div className="react-tool-block">
      <Flex align="center" gap={8} className="react-tool-header">
        {Icon}
        <Tag color="geekblue">{settingStore.tr('Tool')}</Tag>
        <Tag color={getToolColor(toolCall.toolName)}>{toolCall.toolName}</Tag>
        <Typography.Text type="secondary">
          {settingStore.tr('Sub-agents')} ({children.length})
        </Typography.Text>
      </Flex>

      <div>
        {children.map(c => (
          <Flex
            key={c.runId}
            vertical
            gap={4}
            style={{
              paddingBlock: 4,
            }}
          >
            <Flex align="center" gap={8} justify="space-between">
              <Flex align="center" gap={8}>
                {statusIcon(c.status)}
                <Typography.Text type="secondary" code>
                  {c.runId.slice(-10)}
                </Typography.Text>
                <Typography.Text type="secondary">{c.status}</Typography.Text>
              </Flex>
              <Modal
                title={`${settingStore.tr('Sub-agent')} · ${c.runId.slice(-10)}`}
                width="75%"
                footer={false}
                destroyOnHidden
                trigger={
                  <Button size="small" type="link">
                    {settingStore.tr('Detail')}
                  </Button>
                }
              >
                <RunDetailView runId={c.runId} />
              </Modal>
            </Flex>
            {c.query && (
              <Typography.Text ellipsis={{ tooltip: c.query }}>
                {c.query}
              </Typography.Text>
            )}
            {c.brief && (
              <Typography.Paragraph
                type="secondary"
                ellipsis={{ rows: 3, expandable: 'collapsible' }}
                style={{ fontSize: 12 }}
              >
                {c.brief}
              </Typography.Paragraph>
            )}
          </Flex>
        ))}
      </div>

      {toolCall.status === 'failed' && toolCall.error && (
        <Typography.Text type="danger" className="react-tool-error">
          {toolCall.error}
        </Typography.Text>
      )}
    </div>
  );
});
