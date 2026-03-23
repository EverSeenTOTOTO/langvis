import SchemaField, { SchemaProperty } from '@/client/components/SchemaField';
import { useStore } from '@/client/store';
import { Alert, Button, Form, Spin, Typography } from 'antd';
import React, { lazy, Suspense, useEffect } from 'react';
import { useAsyncFn } from 'react-use';
import './index.scss';

const MarkdownRender = lazy(() => import('../MarkdownRender'));

interface HumanInputFormProps {
  conversationId: string;
  message: string;
  schema: SchemaProperty;
  onSubmit?: () => void;
}

type FormState =
  | { type: 'loading' }
  | { type: 'expired'; message: string }
  | { type: 'processing' }
  | { type: 'ready' };

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

  const [sessionState, checkSession] = useAsyncFn(
    chatStore.getSessionState.bind(chatStore),
  );

  // Initial check
  useEffect(() => {
    checkStatus({ conversationId });
  }, [conversationId]);

  // When submitted, check if session still exists
  useEffect(() => {
    if (
      !checkState.loading &&
      checkState.value?.exists &&
      checkState.value?.submitted
    ) {
      checkSession({ conversationId });
    }
  }, [checkState.loading, checkState.value, conversationId]);

  const handleSubmit = async (values: Record<string, unknown>) => {
    await submit({ conversationId, data: values });
    onSubmit?.();
  };

  // Determine form state
  const deriveState = (): FormState => {
    // Still loading initial check
    if (checkState.loading) {
      return { type: 'loading' };
    }

    const inputStatus = checkState.value;

    // Submit error (404 = session expired during submit)
    if (submitState.error?.message?.includes('404')) {
      return {
        type: 'expired',
        message: settingStore.tr(
          'The session has expired. Please start a new conversation.',
        ),
      };
    }

    // Input request doesn't exist
    if (!inputStatus?.exists) {
      return {
        type: 'expired',
        message: settingStore.tr(
          'This request has expired. Please start a new conversation.',
        ),
      };
    }

    // Already submitted
    if (inputStatus.submitted || submitState.value?.success) {
      // Check if backend session still exists
      if (!sessionState.loading && sessionState.value === null) {
        return {
          type: 'expired',
          message: settingStore.tr(
            'Your submission was received but the session has expired. Please start a new conversation.',
          ),
        };
      }

      return { type: 'processing' };
    }

    return { type: 'ready' };
  };

  const state = deriveState();

  if (state.type === 'loading') {
    return (
      <div className="human-input-form">
        <Spin />
      </div>
    );
  }

  if (state.type === 'expired') {
    return (
      <div className="human-input-form">
        <Alert
          type="warning"
          title={settingStore.tr('Session Expired')}
          description={state.message}
          showIcon
        />
      </div>
    );
  }

  if (state.type === 'processing') {
    return (
      <div className="human-input-form">
        <Spin tip={settingStore.tr('Processing...')} />
      </div>
    );
  }

  return (
    <div className="human-input-form">
      <Suspense
        fallback={<Typography.Paragraph>{message}</Typography.Paragraph>}
      >
        <MarkdownRender>{message}</MarkdownRender>
      </Suspense>
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
