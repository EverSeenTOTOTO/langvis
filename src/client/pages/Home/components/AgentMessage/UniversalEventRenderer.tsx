import HumanInputForm from '@/client/components/HumanInputForm';
import { LoadingOutlined } from '@ant-design/icons';
import { Collapse, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { MessageRenderState, ThoughtItem } from './deriveMessageState';
import { NestedAgentCallBlock } from './NestedAgentCallBlock';
import { StandaloneThoughtBlock, ToolBlockItem } from './ToolBlockItem';
import {
  buildToolBlocks,
  detectAwaitingInputRecursive,
  type ToolBlock,
} from './utils';

export interface UniversalEventRendererProps {
  state: MessageRenderState;
  conversationId: string;
  /** Custom render function for tool-specific visualization */
  customToolRender?: (toolCall: ToolBlock['toolCall']) => React.ReactNode;
}

interface DerivedState {
  toolBlocks: ToolBlock[];
  standaloneThoughts: ThoughtItem[];
  awaitingInput: ReturnType<typeof detectAwaitingInputRecursive>;
  isProcessing: boolean;
  showBubbleLoading: boolean;
  shouldExpandDetails: boolean;
}

function deriveState(state: MessageRenderState): DerivedState {
  const { toolCallTimeline, thoughts, isTerminated, hasContent, hasEvents } =
    state;

  const toolBlocks = buildToolBlocks(toolCallTimeline);

  // Use recursive detection for nested awaiting_input
  const rawEvents = state.rawEvents;
  const awaitingInput = detectAwaitingInputRecursive(rawEvents);

  const allToolsSettled =
    toolBlocks.length > 0 && toolBlocks.every(b => !b.isPending);

  const isProcessing =
    hasEvents &&
    !isTerminated &&
    !awaitingInput &&
    !allToolsSettled &&
    !hasContent;

  return {
    toolBlocks,
    standaloneThoughts: thoughts,
    awaitingInput,
    isProcessing,
    showBubbleLoading: !hasContent && !hasEvents && !isTerminated,
    shouldExpandDetails:
      !isTerminated && (toolBlocks.length > 0 || thoughts.length > 0),
  };
}

/**
 * Universal event renderer that supports recursive rendering of nested agent calls.
 * Can be used by any Agent renderer that needs event timeline visualization.
 */
export function UniversalEventRenderer({
  state,
  conversationId,
  customToolRender,
}: UniversalEventRendererProps): React.ReactElement | null {
  const derived = deriveState(state);
  const [activeKey, setActiveKey] = useState<string[]>([]);

  useEffect(() => {
    setActiveKey(derived.shouldExpandDetails ? ['1'] : []);
  }, [derived.shouldExpandDetails]);

  if (
    derived.toolBlocks.length === 0 &&
    derived.standaloneThoughts.length === 0
  ) {
    return null;
  }

  const totalItems =
    derived.toolBlocks.length + derived.standaloneThoughts.length;

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
                {derived.toolBlocks.map(block => {
                  // Use NestedAgentCallBlock for agent_call tools
                  if (block.toolCall.toolName === 'agent_call') {
                    return (
                      <NestedAgentCallBlock
                        key={block.toolCall.callId}
                        toolCall={block.toolCall}
                        conversationId={conversationId}
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
                {derived.standaloneThoughts.map(thought => (
                  <StandaloneThoughtBlock
                    key={`thought-${thought.seq}`}
                    thought={thought}
                  />
                ))}
                {derived.isProcessing && (
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
      {derived.awaitingInput && (
        <HumanInputForm
          conversationId={conversationId}
          message={derived.awaitingInput.message}
          schema={derived.awaitingInput.schema}
        />
      )}
    </>
  );
}
