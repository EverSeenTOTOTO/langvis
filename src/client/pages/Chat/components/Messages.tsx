import { useStore } from '@/client/store';
import { Role } from '@/shared/entities/Message';
import { Flex } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import SystemMessage from './SystemMessage';
import UserMessage from './UserMessage';
import AssistantMessage from './AssistantMessage';

export interface MessageProps {
  msg: any;
  index: number;
  currentMessages: any[];
  onRetry: (messageId: string) => void;
}

const Messages = () => {
  const conversationStore = useStore('conversation');
  const currentMessages = conversationStore.currentConversationId
    ? conversationStore.messages[conversationStore.currentConversationId] || []
    : [];
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleRetry = (messageId: string) => {
    // TODO: 实现重试逻辑
    console.log('Retrying message:', messageId);
  };

  // Scroll to bottom when messages change or update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    currentMessages.length,
    currentMessages[currentMessages.length - 1]?.content,
  ]);

  return (
    <Flex gap="middle" vertical className="chat-messages">
      {currentMessages.map((msg, index) => {
        switch (msg.role) {
          case Role.SYSTEM:
            return (
              <SystemMessage
                key={msg.id}
                msg={msg}
                index={index}
                currentMessages={currentMessages}
                onRetry={handleRetry}
              />
            );
          case Role.USER:
            return (
              <UserMessage
                key={msg.id}
                msg={msg}
                index={index}
                currentMessages={currentMessages}
                onRetry={handleRetry}
              />
            );
          case Role.ASSIST:
            return (
              <AssistantMessage
                key={msg.id}
                msg={msg}
                index={index}
                currentMessages={currentMessages}
                onRetry={handleRetry}
              />
            );
          default:
            return null;
        }
      })}
      <div ref={messagesEndRef} style={{ height: 0 }} />
    </Flex>
  );
};

export default observer(Messages);
