import { ToolConfig } from '@/shared/types';

export const config: ToolConfig = {
  name: {
    en: 'Web Fetch Tool',
    zh: '网页抓取工具',
  },
  description: {
    en: 'A tool to fetch and extract content from web pages. Provide a `url` to fetch the content. The tool will sanitize the HTML and extract the main article content. Returns the title, text content, excerpt, author, and site name.',
    zh: '从网页获取和提取内容的工具。提供 `url` 即可获取内容。该工具会对 HTML 进行消毒并提取主要文章内容。返回标题、纯文本内容、摘要、作者和网站名称。',
  },
};
