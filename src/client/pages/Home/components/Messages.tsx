import { useStore } from '@/client/store';
import { Role } from '@/shared/types/entities';
import {
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { Flex, FloatButton } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useRafState, useScroll } from 'react-use';
import AssistantMessage from './AssistantMessage';
import SystemMessage from './SystemMessage';
import UserMessage from './UserMessage';

const SCROLL_THRESHOLD = 100;

const Messages = () => {
  const conversationStore = useStore('conversation');
  const currentMessages = conversationStore.currentMessages;
  const messagesStartRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollState = useScroll(containerRef);
  const [shouldAutoScroll, setShouldAutoScroll] = useRafState(true);

  const handleRetry = (messageId: string) => {
    console.log('Retrying message:', messageId);
  };

  const scrollToTop = (smooth = true) => {
    messagesStartRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  const isNearTop = scrollState.y < SCROLL_THRESHOLD;

  const isNearBottom =
    containerRef.current &&
    containerRef.current.scrollHeight -
      scrollState.y -
      containerRef.current.clientHeight <
      SCROLL_THRESHOLD;

  useEffect(() => {
    if (scrollState.y > 0) {
      setShouldAutoScroll(isNearBottom || false);
    }
  }, [scrollState.y, isNearBottom, setShouldAutoScroll]);

  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom(false);
    }
  }, [
    currentMessages.length,
    currentMessages[currentMessages.length - 1]?.content,
    shouldAutoScroll,
  ]);

  return (
    <>
      <Flex gap="middle" vertical className="chat-messages" ref={containerRef}>
        <div ref={messagesStartRef} style={{ height: 0 }} />
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
      <FloatButton.Group
        shape="circle"
        className="scroll-btn-group"
      >
        <FloatButton
          icon={<VerticalAlignTopOutlined />}
          onClick={() => scrollToTop(true)}
          //@ts-expect-error disabled?
          disabled={isNearTop}
        />
        <FloatButton
          icon={<VerticalAlignBottomOutlined />}
          onClick={() => scrollToBottom(true)}
          //@ts-expect-error disabled?
          disabled={isNearBottom}
        />
      </FloatButton.Group>
    </>
  );
};

export default observer(Messages);

