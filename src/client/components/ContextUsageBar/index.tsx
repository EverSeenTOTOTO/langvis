import { Progress } from 'antd';
import type { ProgressProps } from 'antd';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useStore } from '@/client/store';
import './ContextUsageBar.scss';

const ContextUsageBar: React.FC = () => {
  const conversationStore = useStore('conversation');

  const contextUsage = conversationStore.contextUsage;

  if (!contextUsage) return null;

  const { used, total } = contextUsage;
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
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
        {formatNumber(used)} / {formatNumber(total)}
      </span>
    </div>
  );
};

export default observer(ContextUsageBar);
