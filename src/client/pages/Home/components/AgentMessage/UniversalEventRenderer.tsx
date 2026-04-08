import HumanInputForm from '@/client/components/HumanInputForm';
import type { MessageFSM } from '@/client/store/modules/MessageFSM';
import { LoadingOutlined } from '@ant-design/icons';
import { Collapse, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { NestedAgentCallBlock } from './NestedAgentCallBlock';
import { StandaloneThoughtBlock, ToolBlockItem } from './ToolBlockItem';
import { buildToolBlocks, type ToolBlock } from './utils';

export interface UniversalEventRendererProps {
  messageFSM: MessageFSM;
  customToolRender?: (toolCall: ToolBlock['toolCall']) => React.ReactNode;
}

/**
 * Universal event renderer that supports recursive rendering of nested agent calls.
 * Can be used by any Agent renderer that needs event timeline visualization.
 */
export function UniversalEventRenderer({
  messageFSM,
  customToolRender,
}: UniversalEventRendererProps): React.ReactElement | null {
  const toolBlocks = buildToolBlocks(messageFSM.toolCallTimeline);
  const thoughts = messageFSM.thoughts;
  const [activeKey, setActiveKey] = useState<string[]>([]);

  useEffect(() => {
    setActiveKey(messageFSM.shouldExpandDetails ? ['1'] : []);
  }, [messageFSM.shouldExpandDetails]);

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
                  // Use NestedAgentCallBlock for agent_call tools
                  if (block.toolCall.toolName === 'agent_call') {
                    return (
                      <NestedAgentCallBlock
                        key={block.toolCall.callId}
                        toolCall={block.toolCall}
                        conversationId={messageFSM.msg.conversationId}
                        depth={0}
                        customToolRender={customToolRender}
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
                {thoughts.map(thought => (
                  <StandaloneThoughtBlock
                    key={`thought-${thought.seq}`}
                    thought={thought}
                  />
                ))}
                {messageFSM.isThinking && (
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
      {messageFSM.awaitingInput && (
        <HumanInputForm
          messageId={messageFSM.msg.id}
          conversationId={messageFSM.msg.conversationId}
          message={messageFSM.awaitingInput.message}
          schema={messageFSM.awaitingInput.schema}
        />
      )}
    </>
  );
}
