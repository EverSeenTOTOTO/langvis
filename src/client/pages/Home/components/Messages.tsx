import { useStore } from '@/client/store';
import { Role } from '@/shared/types/entities';
import { VerticalAlignBottomOutlined } from '@ant-design/icons';
import { Flex, FloatButton } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useScroll } from 'react-use';
import AssistantMessage from './AssistantMessage';
import SystemMessage from './SystemMessage';
import UserMessage from './UserMessage';

const SCROLL_THRESHOLD = 100;

const Messages = () => {
  const conversationStore = useStore('conversation');
  const currentMessages = conversationStore.currentMessages;
  const currentConversationId = conversationStore.currentConversationId;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollState = useScroll(containerRef);

  const handleRetry = (messageId: string) => {
    console.log('Retrying message:', messageId);
  };

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  const checkIsNearBottom = () => {
    if (!containerRef.current) return true;
    const { scrollHeight, scrollTop, clientHeight } = containerRef.current;
    return scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
  };

  // Handle user scroll: update auto-scroll state
  useEffect(() => {
    const isNearBottom = checkIsNearBottom();
    setShowScrollButton(!isNearBottom);

    // User scrolled up (away from bottom)
    if (scrollState.y > 0 && !isNearBottom) {
      shouldAutoScrollRef.current = false;
    }
  }, [scrollState.y]);

  // Auto-scroll to bottom when switching conversations
  useEffect(() => {
    if (currentConversationId) {
      shouldAutoScrollRef.current = true;
      // Wait for messages to render
      requestAnimationFrame(() => scrollToBottom(false));
    }
  }, [currentConversationId]);

  // Auto-scroll when messages change (including streaming content updates)
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom(false);
    }
  }, [currentMessages.length, currentMessages.at(-1)?.content]);

  const handleScrollToBottom = () => {
    scrollToBottom(true);
    shouldAutoScrollRef.current = true;
  };

  return (
    <>
      <Flex gap="middle" vertical className="chat-messages" ref={containerRef}>
        {currentMessages.map(msg => {
          switch (msg.role) {
            case Role.SYSTEM:
              return <SystemMessage key={msg.id} msg={msg} />;
            case Role.USER:
              return (
                <UserMessage key={msg.id} msg={msg} onRetry={handleRetry} />
              );
            case Role.ASSIST:
              return <AssistantMessage key={msg.id} msg={msg} />;
            default:
              return null;
          }
        })}
        <div ref={messagesEndRef} style={{ height: 0 }} />
      </Flex>
      {showScrollButton && (
        <FloatButton
          icon={<VerticalAlignBottomOutlined />}
          onClick={handleScrollToBottom}
          className="scroll-to-bottom"
        />
      )}
    </>
  );
};

export default observer(Messages);
