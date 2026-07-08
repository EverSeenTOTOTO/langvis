import { CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Button, Flex, Tag, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import type { UIToolCall } from '@/client/store/modules/message-node';
import Modal from '@/client/components/Modal';
import { useStore } from '@/client/store';
import { getToolColor } from './ToolBlockItem';
import { RunDetailView } from './RunDetailView';

interface ChildState {
  runId: string;
  status: string;
  query?: string;
  brief?: string;
}

type SubagentProgress = {
  childRunId?: string;
  brief?: string;
  query?: string;
  event?: { type?: string };
};

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

/**
 * CallSubagentsBlock —— 主 agent 的 call_subagents 工具进度块。
 * 从 toolCall.progress 聚合每个子 run 的状态（边跑边更新），渲染子 run 卡片；
 * 点 View 经 CRUD 拉取该子 run 的投影详情（RunDetailView，同一渲染机制）。
 */
export const CallSubagentsBlock = observer(function CallSubagentsBlock({
  toolCall,
}: {
  toolCall: UIToolCall;
}): React.ReactElement {
  const settingStore = useStore('setting');

  const children: ChildState[] = (() => {
    const map = new Map<string, ChildState>();
    const ensure = (id: string): ChildState => {
      let c = map.get(id);
      if (!c) {
        c = { runId: id, status: 'running' };
        map.set(id, c);
      }
      return c;
    };
    for (const p of toolCall.progress) {
      const d = p as SubagentProgress | undefined;
      const id = d?.childRunId;
      if (!id) continue;
      const c = ensure(id);
      if (d.brief !== undefined) c.brief = d.brief;
      if (d.query !== undefined) c.query = d.query;
      const ev = d.event;
      if (!ev) continue;
      if (ev.type === 'final') c.status = 'completed';
      else if (ev.type === 'error') c.status = 'failed';
      else if (ev.type === 'cancelled') c.status = 'cancelled';
    }
    return [...map.values()];
  })();

  const Icon = statusIcon(
    toolCall.status === 'pending' ? 'running' : toolCall.status,
  );

  return (
    <div className="react-tool-block">
      <Flex align="center" gap={8} className="react-tool-header">
        {Icon}
        <Tag color="geekblue">Tool</Tag>
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
