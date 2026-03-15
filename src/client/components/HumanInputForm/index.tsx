import SchemaField, { SchemaProperty } from '@/client/components/SchemaField';
import { useStore } from '@/client/store';
import { Button, Form, Spin } from 'antd';
import React, { useEffect } from 'react';
import { useAsyncFn } from 'react-use';
import MarkdownRender from '../MarkdownRender';
import './index.scss';

interface HumanInputFormProps {
  conversationId: string;
  message: string;
  schema: SchemaProperty;
  onSubmit?: () => void;
}

const HumanInputForm: React.FC<HumanInputFormProps> = ({
  conversationId,
  message,
  schema,
  onSubmit,
}) => {
  const [form] = Form.useForm();
  const settingStore = useStore('setting');
  const chatStore = useStore('chat');

  const [submitState, submit] = useAsyncFn(
    chatStore.submitHumanInput.bind(chatStore),
  );

  const [checkState, checkStatus] = useAsyncFn(
    chatStore.getHumanInputStatus.bind(chatStore),
  );

  useEffect(() => {
    checkStatus({ conversationId });
  }, [conversationId]);

  const handleSubmit = async (values: Record<string, unknown>) => {
    await submit({ conversationId, data: values });
    onSubmit?.();
  };

  const hasSubmitted =
    (checkState.value?.exists && checkState.value?.submitted) ||
    submitState.value?.success;

  if (checkState.loading) {
    return (
      <div className="human-input-form">
        <Spin />
      </div>
    );
  }

  if (hasSubmitted) {
    return (
      <div className="human-input-form">
        <Spin tip={settingStore.tr('Processing...')} />
      </div>
    );
  }

  return (
    <div className="human-input-form">
      <MarkdownRender>{message}</MarkdownRender>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        {schema.type === 'object' && schema.properties ? (
          Object.entries(schema.properties).map(([key, prop]) => (
            <SchemaField
              key={key}
              name={key}
              prop={prop as SchemaProperty}
              required={schema.required?.includes(key)}
            />
          ))
        ) : (
          <SchemaField name="value" prop={schema} required />
        )}
        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={submitState.loading}
            block
          >
            {settingStore.tr('Submit')}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export default HumanInputForm;
