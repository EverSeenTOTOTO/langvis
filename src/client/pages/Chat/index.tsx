import { useStore } from '@/client/store';
import { Sender } from '@ant-design/x';
import { Layout, message } from 'antd';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAsyncFn } from 'react-use';
import ConversationsSider from './components/ConversationsSider';
import Messages from './components/Messages';
import './index.scss';

const { Content } = Layout;

const Chat: React.FC = () => {
  const conversationStore = useStore('conversation');
  const settingStore = useStore('setting');
  const [value, setValue] = useState('');

  const createConversationApi = useAsyncFn(
    conversationStore.createConversation.bind(conversationStore),
  );
  const addMessageApi = useAsyncFn(
    conversationStore.addMessageToConversation.bind(conversationStore),
  );

  const handleSend = async () => {
    if (!value) return;

    if (!conversationStore.currentConversationId) {
      await createConversationApi[1]({
        name: settingStore.tr('New Conversation'),
      });
    }

    if (!conversationStore.currentConversationId) {
      message.error(settingStore.tr('Failed to create or get conversation'));
      return;
    }

    setValue('');

    await conversationStore.handleUserMessage(value);
  };

  return (
    <Layout className="chat-page">
      <ConversationsSider />
      <Content className="chat-content">
        <Messages />
        <div className="chat-input">
          <Sender
            value={value}
            onChange={setValue}
            onSubmit={handleSend}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder={settingStore.tr('Type a message...')}
            loading={
              addMessageApi[0].loading || createConversationApi[0].loading
            }
          />
        </div>
        <div className="chat-input-placeholder" />
      </Content>
    </Layout>
  );
};

export default observer(Chat);
