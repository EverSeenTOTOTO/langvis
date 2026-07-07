import HumanInputForm from '@/client/components/HumanInputForm';
import type { MessageNode } from '@/client/store/modules/message-node';
import type { UIToolCall } from '@/client/store/modules/message-node';
import { LoadingOutlined } from '@ant-design/icons';
import { Collapse, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useState } from 'react';
import { SkillCallBlock } from './SkillCallBlock';
import { CallSubagentsBlock } from './CallSubagentsBlock';
import { StandaloneThoughtBlock, ToolBlockItem } from './ToolBlockItem';

export interface UniversalEventRendererProps {
  node: MessageNode;
  customToolRender?: (toolCall: UIToolCall) => React.ReactNode;
}

/**
 * Universal event renderer that supports recursive rendering of nested agent calls.
 * Can be used by any Agent renderer that needs event timeline visualization.
 */
// observer(): this component reads node observables (toolCalls, timeline,
// shouldExpandDetails, and crucially `awaitingInput`) that AssistantMessage
// does NOT read — so it must subscribe independently, or changes to
// `_awaitingInputData` (set on a tool_progress frame) won't re-render it.
export const UniversalEventRenderer = observer(function UniversalEventRenderer({
  node,
  customToolRender,
}: UniversalEventRendererProps): React.ReactElement | null {
  const timeline = node.timeline;
  // Resolve each timeline tool item to its live UIToolCall. Built per render
  // (cheap) so it never goes stale as new tool_calls are appended — mobx
  // observable arrays mutate in place, so a useMemo keyed on the array ref
  // would miss pushes.
  const toolByCallId = new Map(node.toolCalls.map(tc => [tc.callId, tc]));
  const awaiting = node.awaitingInput;
  const [activeKey, setActiveKey] = useState<string[]>([]);

  useEffect(() => {
    setActiveKey(node.shouldExpandDetails ? ['1'] : []);
  }, [node.shouldExpandDetails]);

  if (timeline.length === 0) {
    return null;
  }

  return (
    <Collapse
      size="small"
      activeKey={activeKey}
      onChange={keys => setActiveKey(keys as string[])}
      items={[
        {
          key: '1',
          label: (
            <Typography.Text type="secondary">
              Process Details ({timeline.length} blocks)
            </Typography.Text>
          ),
          children: (
            <div className="react-tool-list">
              {timeline.map(item => {
                if (item.kind === 'thought') {
                  return (
                    <StandaloneThoughtBlock
                      key={item.key}
                      thought={item.content}
                    />
                  );
                }

                const tc = toolByCallId.get(item.callId);
                if (!tc) return null;

                const toolEl =
                  tc.toolName === 'skill_call' ? (
                    <SkillCallBlock toolCall={tc} depth={0} />
                  ) : tc.toolName === 'call_subagents' ? (
                    <CallSubagentsBlock toolCall={tc} />
                  ) : (
                    <ToolBlockItem
                      toolCall={tc}
                      depth={0}
                      customRender={customToolRender}
                    />
                  );

                // Render the ask_user form inline right after the tool that
                // requested it — in arrival order, not pinned to the bottom.
                const showForm = awaiting?.callId === tc.callId;

                return (
                  <Fragment key={tc.callId}>
                    {toolEl}
                    {showForm && awaiting && (
                      <HumanInputForm
                        key={awaiting.callId}
                        messageId={node.id}
                        conversationId={node.conversationId}
                        message={awaiting.message}
                        schema={awaiting.schema}
                      />
                    )}
                  </Fragment>
                );
              })}
              {node.isThinking && (
                <div className="react-tool-processing">
                  <LoadingOutlined style={{ marginInlineEnd: 8 }} />
                  <Typography.Text type="secondary" italic>
                    Processing...
                  </Typography.Text>
                </div>
              )}
            </div>
          ),
        },
      ]}
      style={{ width: '100%', marginBlock: 8 }}
    />
  );
});
