import { Skeleton, Typography } from 'antd';
import { lazy, useEffect } from 'react';
import { useAsyncFn } from 'react-use';
import { useStore } from '@/client/store';
import type { RunViewResult } from '@/server/modules/agent/application/service/run-projection';
import { RunSteps } from './RunSteps';

const MarkdownRender = lazy(() => import('@/client/components/MarkdownRender'));

export interface RunDetailViewProps {
  runId: string;
}

/**
 * RunDetailView —— 子 agent（或任意 run）的进度详情，CRUD 一次性读取（非实时）。
 * 数据来源与历史消息同一投影（projectRun → RunView），由 RunSteps 复用既有步骤渲染。
 */
export function RunDetailView({
  runId,
}: RunDetailViewProps): React.ReactElement {
  const agentStore = useStore('agent');
  const [state, fetch] = useAsyncFn(agentStore.getRunViewById.bind(agentStore));

  useEffect(() => {
    void fetch({ runId });
  }, [fetch, runId]);

  if (state.loading) {
    return <Skeleton active loading />;
  }
  if (state.error || !state.value) {
    return (
      <Typography.Text type="danger">
        Failed to load run {runId}.
      </Typography.Text>
    );
  }

  const { view } = state.value as RunViewResult;

  return (
    <div>
      <RunSteps steps={view.steps} />
      {view.content && <MarkdownRender>{view.content}</MarkdownRender>}
    </div>
  );
}
