import { useStore } from '@/client/store';
import { Role } from '@/shared/types/entities';
import { VerticalAlignBottomOutlined } from '@ant-design/icons';
import { Flex, FloatButton } from 'antd';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { usePrevious, useScroll } from 'react-use';
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
  const prevScrollY = usePrevious(scrollState.y);

  const handleRetry = (_messageId: string) => {
    // Placeholder for retry functionality
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
  // Only disable auto-scroll when user intentionally scrolls UP (away from bottom)
  useEffect(() => {
    const isNearBottom = checkIsNearBottom();
    setShowScrollButton(!isNearBottom);

    const currentY = scrollState.y;

    // User scrolled back to bottom - re-enable auto-scroll
    if (isNearBottom) {
      shouldAutoScrollRef.current = true;
    }
    // User scrolled UP (away from bottom) - disable auto-scroll
    // Skip if prevScrollY is undefined (first render)
    else if (
      prevScrollY !== undefined &&
      currentY < prevScrollY &&
      currentY > 0
    ) {
      shouldAutoScrollRef.current = false;
    }
  }, [scrollState.y, prevScrollY]);

  // Auto-scroll to bottom when switching conversations
  useEffect(() => {
    if (currentConversationId) {
      shouldAutoScrollRef.current = true;
      // Wait for messages to render
      requestAnimationFrame(() => scrollToBottom(false));
    }
  }, [currentConversationId]);

  // Auto-scroll when messages change (including streaming content updates)
  // Use MobX reaction to properly track observable changes
  useEffect(() => {
    const dispose = reaction(
      () => {
        const messages = conversationStore.currentMessages;
        const lastMsg = messages[messages.length - 1];
        return {
          length: messages.length,
          lastId: lastMsg?.id,
          lastContent: lastMsg?.content,
          lastEventsLen: lastMsg?.meta?.events?.length,
        };
      },
      () => {
        if (shouldAutoScrollRef.current) {
          scrollToBottom(false);
        }
      },
    );
    return dispose;
  }, [conversationStore]);

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
