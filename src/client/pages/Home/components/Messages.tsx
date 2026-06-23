import { useStore } from '@/client/store';
import { Role } from '@/shared/types/entities';
import {
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { FloatButton } from 'antd';
import { observer } from 'mobx-react-lite';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import AssistantMessage from './AssistantMessage';
import SystemMessage from './SystemMessage';
import UserMessage from './UserMessage';

const PIN_THRESHOLD = 80;

export interface MessagesRef {
  scrollToBottom: (smooth?: boolean) => void;
}

const Messages = forwardRef<MessagesRef>((_props, ref) => {
  const conversationStore = useStore('conversation');
  const currentMessages = conversationStore.currentMessages.filter(
    msg => !msg.meta?.hidden,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Stick-to-bottom flag. Ref-only: read in scroll/ResizeObserver callbacks
  // without triggering re-renders.
  const isPinnedRef = useRef(true);
  const prevConversationId = useRef(conversationStore.currentConversationId);

  const scrollToBottom = (smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    isPinnedRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  const scrollToTop = (smooth = true) => {
    containerRef.current?.scrollTo({
      top: 0,
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  useImperativeHandle(ref, () => ({ scrollToBottom }));

  // Unpin when the user scrolls away from the bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      isPinnedRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Keep the bottom in view while pinned as content grows — covers streaming
  // tokens and expanding tool/thought blocks, which re-render without changing
  // the message list (so the layout effect below doesn't fire).
  useEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (isPinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const conversationId = conversationStore.currentConversationId;
  const lastMessageId = currentMessages[currentMessages.length - 1]?.id;
  // Scroll on the commit a message lands (synchronous, before paint — newly
  // appended messages are never shown obscured) or a conversation switches.
  useLayoutEffect(() => {
    if (prevConversationId.current !== conversationId) {
      prevConversationId.current = conversationId;
      isPinnedRef.current = true;
    }
    if (!isPinnedRef.current) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId, lastMessageId, currentMessages.length]);

  const handleRetry = (messageId: string) => {
    console.log('Retrying message:', messageId);
  };

  return (
    <>
      <div className="chat-messages" ref={containerRef}>
        <div className="chat-messages-content" ref={contentRef}>
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
        </div>
      </div>
      <FloatButton.Group shape="circle" className="scroll-btn-group">
        <FloatButton
          icon={<VerticalAlignTopOutlined />}
          onClick={() => scrollToTop(true)}
        />
        <FloatButton
          icon={<VerticalAlignBottomOutlined />}
          onClick={() => scrollToBottom(true)}
        />
      </FloatButton.Group>
    </>
  );
});

Messages.displayName = 'Messages';

export default observer(Messages);
