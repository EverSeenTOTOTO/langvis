import { ToolConfig } from '@/shared/types';

export const config: ToolConfig = {
  name: {
    en: 'Web Fetch Tool',
    zh: '网页抓取工具',
  },
  description: {
    en: 'A tool to fetch and extract content from web pages.',
    zh: '从网页获取和提取内容的工具。',
  },
  input: {
    url: {
      type: 'text',
      required: true,
      description: {
        en: 'The URL of the web page to fetch. Must be a valid HTTP/HTTPS URL.',
        zh: '要获取的网页 URL。必须是有效的 HTTP/HTTPS URL。',
      },
    },
    timeout: {
      type: 'number',
      required: false,
      initialValue: 30_000,
      description: {
        en: 'Request timeout in milliseconds. Default is 30000 (30 seconds).',
        zh: '请求超时时间（毫秒）。默认为 30000（30 秒）。',
      },
    },
  },
  output: {
    title: {
      type: 'text',
      description: {
        en: 'The title of the article or page',
        zh: '文章或页面的标题',
      },
    },
    textContent: {
      type: 'text',
      description: {
        en: 'The main text content of the article, with HTML tags removed',
        zh: '文章的主要文本内容，已移除 HTML 标签',
      },
    },
    excerpt: {
      type: 'text',
      description: {
        en: 'A short excerpt or summary of the article',
        zh: '文章的简短摘要',
      },
    },
    byline: {
      type: 'text',
      description: {
        en: 'The author or attribution information, may be null if not found',
        zh: '作者或署名信息，如果未找到则为 null',
      },
    },
    siteName: {
      type: 'text',
      description: {
        en: 'The name of the website or publication, may be null if not found',
        zh: '网站或出版物的名称，如果未找到则为 null',
      },
    },
    url: {
      type: 'text',
      description: {
        en: 'The original URL that was fetched',
        zh: '获取的原始 URL',
      },
    },
  },
};
