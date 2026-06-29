import { Progress } from 'antd';
import type { ProgressProps } from 'antd';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useStore } from '@/client/store';
import './ContextUsageBar.scss';

const ContextUsageBar: React.FC = () => {
  const conversationStore = useStore('conversation');

  // 两层：活跃 loop（运行中）显示其实时自增量；空闲时回落到会话基线。
  // 多 run 时取最近一条 loop（per-bubble 展示是后续 UI 事；数据模型已按 runId 容纳）。
  const activeLoop = Array.from(conversationStore.loopUsage.values()).pop();
  const usage = activeLoop ?? conversationStore.conversationUsage;

  if (!usage) return null;

  const { used, total } = usage;
  const percentage = Math.min((used / total) * 100, 100);

  const formatNumber = (n: number): string => {
    if (n >= 1000000) {
      return `${(n / 1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
      return `${(n / 1000).toFixed(1)}K`;
    }
    return n.toString();
  };

  const styles: ProgressProps['styles'] = {
    track: {
      backgroundImage: `linear-gradient(
        to right,
        hsla(${200 - (200 * percentage) / 100}, 85%, 65%, 1),
        hsla(${230 - (200 * percentage) / 100}, 90%, 55%, 0.95)
      )`,
      borderRadius: 6,
      transition: 'all 0.3s ease',
    },
    rail: {
      backgroundColor: 'rgba(255, 255, 255)',
      borderRadius: 6,
    },
  };

  return (
    <div className={clsx('context-usage-bar')}>
      <Progress
        percent={percentage}
        showInfo={false}
        size="small"
        styles={styles}
      />
      <span className="context-usage-text">
        {formatNumber(used)} / {formatNumber(total)} ({percentage.toFixed(1)}%)
      </span>
    </div>
  );
};

export default observer(ContextUsageBar);
