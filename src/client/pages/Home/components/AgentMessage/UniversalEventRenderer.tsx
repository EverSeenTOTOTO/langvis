import HumanInputForm from '@/client/components/HumanInputForm';
import type { MessageNode } from '@/client/store/modules/message-node';
import type { UIToolCall } from '@/client/store/modules/message-node';
import { LoadingOutlined } from '@ant-design/icons';
import { Collapse, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { SkillCallBlock } from './SkillCallBlock';
import { StandaloneThoughtBlock, ToolBlockItem } from './ToolBlockItem';
import { buildToolBlocks } from './utils';

export interface UniversalEventRendererProps {
  node: MessageNode;
  customToolRender?: (toolCall: UIToolCall) => React.ReactNode;
}

/**
 * Universal event renderer that supports recursive rendering of nested agent calls.
 * Can be used by any Agent renderer that needs event timeline visualization.
 */
// observer(): this component reads node observables (toolCalls, thoughts,
// shouldExpandDetails, and crucially `awaitingInput`) that AssistantMessage
// does NOT read — so it must subscribe independently, or changes to
// `_awaitingInputData` (set on a tool_progress frame) won't re-render it.
export const UniversalEventRenderer = observer(function UniversalEventRenderer({
  node,
  customToolRender,
}: UniversalEventRendererProps): React.ReactElement | null {
  const toolBlocks = buildToolBlocks(node.toolCalls);
  const thoughts = node.thoughts;
  const [activeKey, setActiveKey] = useState<string[]>([]);

  useEffect(() => {
    setActiveKey(node.shouldExpandDetails ? ['1'] : []);
  }, [node.shouldExpandDetails]);

  if (toolBlocks.length === 0 && thoughts.length === 0) {
    return null;
  }

  const totalItems = toolBlocks.length + thoughts.length;

  return (
    <>
      <Collapse
        size="small"
        activeKey={activeKey}
        onChange={keys => setActiveKey(keys as string[])}
        items={[
          {
            key: '1',
            label: (
              <Typography.Text type="secondary">
                Process Details ({totalItems} steps)
              </Typography.Text>
            ),
            children: (
              <div className="react-tool-list">
                {toolBlocks.map(block => {
                  // Use SkillCallBlock for skill_call tools
                  if (block.toolCall.toolName === 'skill_call') {
                    return (
                      <SkillCallBlock
                        key={block.toolCall.callId}
                        toolCall={block.toolCall}
                        depth={0}
                      />
                    );
                  }
                  return (
                    <ToolBlockItem
                      key={block.toolCall.callId}
                      toolCall={block.toolCall}
                      depth={0}
                      customRender={customToolRender}
                    />
                  );
                })}
                {thoughts.map((thought, index) => (
                  <StandaloneThoughtBlock
                    key={`thought-${index}`}
                    thought={thought}
                  />
                ))}
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
      {node.awaitingInput && (
        <HumanInputForm
          key={node.awaitingInput.callId}
          messageId={node.id}
          conversationId={node.conversationId}
          message={node.awaitingInput.message}
          schema={node.awaitingInput.schema}
        />
      )}
    </>
  );
});
