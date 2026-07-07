import type { ReActStep } from '@/shared/types/render';
import {
  stepsToToolCalls,
  stepsToTimeline,
} from '@/client/store/modules/message-node';
import { StandaloneThoughtBlock, ToolBlockItem } from './ToolBlockItem';

export interface RunStepsProps {
  steps: ReActStep[];
}

/**
 * 任意 run 的步骤渲染——把 ReActStep[] 转成 UIToolCall/timeline 后复用
 * ToolBlockItem / StandaloneThoughtBlock（与消息实时路径同一渲染机制，无子 agent 专属渲染）。
 */
export function RunSteps({ steps }: RunStepsProps): React.ReactElement | null {
  if (steps.length === 0) return null;
  const toolCalls = stepsToToolCalls(steps);
  const timeline = stepsToTimeline(steps);
  const toolByCallId = new Map(toolCalls.map(tc => [tc.callId, tc]));

  return (
    <div className="react-tool-list">
      {timeline.map(item => {
        if (item.kind === 'thought') {
          return (
            <StandaloneThoughtBlock key={item.key} thought={item.content} />
          );
        }
        const tc = toolByCallId.get(item.callId);
        if (!tc) return null;
        return <ToolBlockItem key={tc.callId} toolCall={tc} depth={0} />;
      })}
    </div>
  );
}
