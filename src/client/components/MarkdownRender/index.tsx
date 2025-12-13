import { useStore } from '@/client/store';
import { observer } from 'mobx-react-lite';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeMathjax from 'rehype-mathjax';
import { useCallback, useEffect, useRef, useState } from 'react';

const MarkdownRender = observer(({ children }: { children: string }) => {
  const settingStore = useStore('setting');
  const [, forceUpdate] = useState(0);

  // Lazy load SyntaxHighlighter to reduce initial bundle size
  const syntaxComponentsRef = useRef<{
    SyntaxHighlighter: any;
    oneDark: any;
    oneLight: any;
  } | null>(null);

  const loadSyntaxComponents = useCallback(async () => {
    if (import.meta.env.DEV) return;
    if (!syntaxComponentsRef.current) {
      const [SyntaxHighlighter, oneDark, oneLight] = await Promise.all([
        import('react-syntax-highlighter').then(module => module.Prism),
        import('react-syntax-highlighter/dist/cjs/styles/prism').then(
          module => module.oneDark,
        ),
        import('react-syntax-highlighter/dist/cjs/styles/prism').then(
          module => module.oneLight,
        ),
      ]);
      syntaxComponentsRef.current = {
        SyntaxHighlighter,
        oneDark,
        oneLight,
      };
      forceUpdate(n => n + 1);
    }
  }, []);

  useEffect(() => {
    forceUpdate(n => n + 1);
  }, [settingStore.mode]);

  // Load syntax highlighting components on client side only
  useEffect(() => {
    loadSyntaxComponents().catch(error => {
      console.error('Failed to load syntax highlighting components:', error);
    });
  }, []);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
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

export default MarkdownRender;
