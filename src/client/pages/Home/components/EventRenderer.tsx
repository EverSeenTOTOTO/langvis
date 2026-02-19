import { AgentEvent } from '@/shared/types';
import { Collapse, Flex, Steps, Tag, Typography } from 'antd';
import { StepsProps } from 'antd/lib';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';

const EventRenderer: React.FC<{ events: AgentEvent[] }> = ({ events }) => {
  const [activeKey, setActiveKey] = useState<string[]>([]);

  useEffect(() => {
    if (events.find(e => e.type === 'final')) {
      setActiveKey([]);
    } else if (events.length) {
      setActiveKey(['1']);
    }
  }, [events]);

  // Build steps from events
  const steps: StepsProps['items'] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    const isLast = i === events.length - 1;
    const lastStep = steps[steps.length - 1];
    const at = (
      <Tag color="lime">{dayjs(event.at).format('YYYY-MM-DD HH:mm:ss')}</Tag>
    );

    switch (event.type) {
      case 'thought':
        steps.push({
          title: (
            <Flex align="center">
              Thinking
              {at}
            </Flex>
          ),
          status: isLast ? 'process' : 'finish',
          description: (
            <Typography.Paragraph
              type="secondary"
              italic
              ellipsis={{ rows: 2, expandable: 'collapsible' }}
            >
              {event.content}
            </Typography.Paragraph>
          ),
        });
        break;
      case 'tool_call':
        steps.push({
          title: (
            <Flex>
              Tool <Tag color="orange">{event.toolName}</Tag>
              {at}
            </Flex>
          ),
          status: 'process',
          description: (
            <Typography.Text type="secondary" italic>
              {JSON.stringify(event.toolArgs)}
            </Typography.Text>
          ),
        });
        break;
      case 'tool_result':
        // Update last step (tool_call) with result
        if (lastStep) {
          lastStep.status = 'finish';
          lastStep.content = (
            <Typography.Paragraph
              type="secondary"
              copyable
              ellipsis={{ rows: 3, expandable: 'collapsible' }}
            >
              {typeof event.output === 'string'
                ? event.output
                : JSON.stringify(event.output)}
            </Typography.Paragraph>
          );
        }
        break;
      case 'tool_error':
        // Update last step (tool_call) with error
        if (lastStep) {
          lastStep.status = 'error';
          lastStep.content = (
            <Typography.Paragraph
              type="danger"
              ellipsis={{ rows: 2, expandable: 'collapsible' }}
            >
              {event.error}
            </Typography.Paragraph>
          );
        }
        break;
      case 'tool_progress':
      case 'start':
      case 'stream':
      case 'error':
      case 'final':
      default:
        continue;
    }
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
            <Typography.Text type="secondary">Process Details</Typography.Text>
          ),
          children: (
            <Steps
              size="small"
              orientation="vertical"
              current={steps.length}
              items={steps}
            />
          ),
        },
      ]}
      style={{ width: '100%', marginBlock: 8 }}
    />
  );
};

export default EventRenderer;
