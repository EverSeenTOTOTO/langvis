import { useStore } from '@/client/store';
import { Role } from '@/shared/entities/Message';
import { RobotOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { Flex } from 'antd';
import { observer } from 'mobx-react-lite';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeMathjax from 'rehype-mathjax';
import { useEffect, useRef, useState } from 'react';

// Lazy load SyntaxHighlighter to reduce initial bundle size
const syntaxComponentsRef: {
  current: { SyntaxHighlighter: any; oneDark: any; oneLight: any } | null;
} = { current: null };
const loadSyntaxComponents = () => {
  if (!syntaxComponentsRef.current) {
    return Promise.all([
      import('react-syntax-highlighter').then(module => module.Prism),
      import('react-syntax-highlighter/dist/cjs/styles/prism').then(
        module => module.oneDark,
      ),
      import('react-syntax-highlighter/dist/cjs/styles/prism').then(
        module => module.oneLight,
      ),
    ]).then(([SyntaxHighlighter, oneDark, oneLight]) => {
      syntaxComponentsRef.current = {
        SyntaxHighlighter,
        oneDark,
        oneLight,
      };
    });
  }
  return Promise.resolve();
};

const MarkdownRender = observer(({ children }: { children: string }) => {
  const settingStore = useStore('setting');
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    forceUpdate(n => n + 1);
  }, [settingStore.mode]);

  // Load syntax highlighting components on client side only
  useEffect(() => {
    loadSyntaxComponents()
      .then(() => {
        forceUpdate(n => n + 1);
      })
      .catch(error => {
        console.error('Failed to load syntax highlighting components:', error);
      });
  }, []);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeMathjax]}
      components={{
        a: ({ ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
        code({ inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');

          // Only render syntax highlighted code blocks when components are loaded
          if (!inline && match && syntaxComponentsRef.current) {
            const { SyntaxHighlighter, oneDark, oneLight } =
              syntaxComponentsRef.current;
            return (
              <SyntaxHighlighter
                {...props}
                style={settingStore.mode === 'dark' ? oneDark : oneLight}
                language={match[1]}
                PreTag="div"
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            );
          }

          return (
            <code {...props} className={className}>
              {children}
            </code>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
});

const fooAvatar: React.CSSProperties = {
  color: '#f56a00',
  backgroundColor: '#fde3cf',
};

const barAvatar: React.CSSProperties = {
  color: '#fff',
  backgroundColor: '#87d068',
};

const hideAvatar: React.CSSProperties = {
  visibility: 'hidden',
};

const Messages = () => {
  const conversationStore = useStore('conversation');
  const currentMessages = conversationStore.currentConversationId
    ? conversationStore.messages[conversationStore.currentConversationId] || []
    : [];
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change or update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    currentMessages.length,
    currentMessages[currentMessages.length - 1]?.content,
  ]);

  return (
    <Flex gap="middle" vertical className="chat-messages">
      {currentMessages.map((msg, index) => (
        <Bubble
          key={msg.id}
          placement={msg.role === Role.USER ? 'end' : 'start'}
          content={msg.content}
          loading={msg.loading}
          avatar={
            msg.role === Role.USER
              ? { icon: <UserOutlined />, style: barAvatar }
              : { icon: <RobotOutlined />, style: fooAvatar }
          }
          styles={
            index > 0 && currentMessages[index - 1].role === msg.role
              ? { avatar: hideAvatar }
              : {}
          }
          messageRender={content => <MarkdownRender>{content}</MarkdownRender>}
        />
      ))}
      <div ref={messagesEndRef} style={{ height: 0 }} />
    </Flex>
  );
};

export default observer(Messages);
