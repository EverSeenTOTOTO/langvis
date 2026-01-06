import MarkdownRender from '@/client/components/MarkdownRender';
import { useStore } from '@/client/store';
import type { ReActStep } from '@/server/core/agent/ReAct';
import { Message } from '@/shared/entities/Message';
import { LoadingOutlined } from '@ant-design/icons';
import { Collapse, Flex, Spin, Steps, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';

const ReActAgentMessage = ({
  msg,
}: {
  msg: Message<{ steps?: ReActStep[] }>;
}) => {
  const [activeKey, setActiveKey] = useState<string[]>(['1']);
  const settingStore = useStore('setting');
  const hasFinalAnswer = msg.meta?.steps?.some(step => 'final_answer' in step);

  useEffect(() => {
    if (hasFinalAnswer) {
      setActiveKey([]);
    }
  }, [hasFinalAnswer]);

  return (
    <Flex vertical align="start">
      <Collapse
        size="small"
        activeKey={activeKey}
        onChange={keys => setActiveKey(keys as string[])}
        items={[
          {
            key: '1',
            label: settingStore.tr('Process Details'),
            children: (
              <Steps
                size="small"
                orientation="vertical"
                className="react-steps"
                type="dot"
                current={msg.meta?.steps?.length}
                items={(msg.meta?.steps || []).map(step => {
                  if ('final_answer' in step) {
                    return {
                      title: 'Final Answer',
                      content: step.thought ? (
                        <Typography.Paragraph
                          type="secondary"
                          copyable
                          ellipsis={{
                            rows: 3,
                            expandable: 'collapsible',
                          }}
                        >
                          {step.thought}
                        </Typography.Paragraph>
                      ) : undefined,
                    };
                  }

                  if ('action' in step) {
                    return {
                      title: `Action: ${step.action.tool}`,
                      content: (
                        <>
                          {step.thought && (
                            <Typography.Paragraph
                              type="secondary"
                              italic
                              ellipsis={{
                                rows: 2,
                                expandable: 'collapsible',
                              }}
                            >
                              {step.thought}
                            </Typography.Paragraph>
                          )}
                          <Typography.Paragraph
                            type="secondary"
                            copyable
                            ellipsis={{
                              rows: 3,
                              expandable: 'collapsible',
                            }}
                          >
                            {JSON.stringify(step.action.input, null, 2)}
                          </Typography.Paragraph>
                        </>
                      ),
                    };
                  }

                  if ('observation' in step) {
                    return {
                      title: 'Observation',
                      content: (
                        <Typography.Paragraph
                          type="secondary"
                          copyable
                          ellipsis={{
                            rows: 3,
                            expandable: 'collapsible',
                          }}
                        >
                          {step.observation}
                        </Typography.Paragraph>
                      ),
                    };
                  }

                  return { title: 'Unknown Step' };
                })}
              />
            ),
          },
        ]}
        style={{ width: '100%', marginBlockStart: 16 }}
      />

      {!hasFinalAnswer && (
        <Spin
          indicator={<LoadingOutlined spin />}
          style={{ marginBlock: 12 }}
        />
      )}
      {hasFinalAnswer && <MarkdownRender>{msg.content}</MarkdownRender>}
    </Flex>
  );
};

export default observer(ReActAgentMessage);
