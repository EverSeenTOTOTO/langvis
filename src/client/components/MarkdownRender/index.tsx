import { useStore } from '@/client/store';
import { message } from 'antd';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useCopyToClipboard } from 'react-use';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import './index.scss';

const CodeBlock = ({
  language,
  code,
  style,
  SyntaxHighlighter,
}: {
  language: string;
  code: string;
  style: any;
  SyntaxHighlighter: any;
}) => {
  const [copied, setCopied] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();

  const handleCopy = useCallback(() => {
    copyToClipboard(code);
    message.success('Copied');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code, copyToClipboard]);

  return (
    <div className="code-block-wrapper">
      <button
        className="copy-button"
        onClick={handleCopy}
        aria-label="Copy code"
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z" />
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z" />
          </svg>
        )}
      </button>
      <SyntaxHighlighter style={style} language={language} PreTag="div">
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

const MarkdownRender = observer(({ children }: { children: string }) => {
  const settingStore = useStore('setting');
  const [, forceUpdate] = useState(0);

  const componentsRef = useRef<{
    SyntaxHighlighter: any;
    oneDark: {
      [key: string]: React.CSSProperties;
    };
    oneLight: {
      [key: string]: React.CSSProperties;
    };
    rehypeMathjax: any;
  } | null>(null);

  const loadComponents = useCallback(async () => {
    if (import.meta.env.DEV) return;
    if (!componentsRef.current) {
      const [SyntaxHighlighter, oneDark, oneLight, rehypeMathjax] =
        await Promise.all([
          import('react-syntax-highlighter').then(module => module.Prism),
          import('react-syntax-highlighter/dist/cjs/styles/prism').then(
            module => module.oneDark,
          ),
          import('react-syntax-highlighter/dist/cjs/styles/prism').then(
            module => module.oneLight,
          ),
          import('rehype-mathjax').then(module => module.default),
        ]);
      componentsRef.current = {
        SyntaxHighlighter,
        oneDark,
        oneLight,
        rehypeMathjax,
      };
      forceUpdate(n => n + 1);
    }
  }, []);

  useEffect(() => {
    forceUpdate(n => n + 1);
  }, [settingStore.mode]);

  useEffect(() => {
    loadComponents().catch(error => {
      console.error('Failed to load markdown components:', error);
    });
  }, [loadComponents]);

  return (
    <div className="markdown-render">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={
          componentsRef.current?.rehypeMathjax
            ? [componentsRef.current.rehypeMathjax]
            : []
        }
        components={{
          a: ({ ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');

            if (!inline && match && componentsRef.current) {
              const { SyntaxHighlighter, oneDark, oneLight } =
                componentsRef.current;
              const code = String(children).replace(/\n$/, '');
              return (
                <CodeBlock
                  language={match[1]}
                  code={code}
                  style={settingStore.mode === 'dark' ? oneDark : oneLight}
                  SyntaxHighlighter={SyntaxHighlighter}
                />
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
    </div>
  );
});

export default MarkdownRender;
