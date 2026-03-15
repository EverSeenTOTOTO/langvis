import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Prompt } from '../../PromptBuilder';
import type { MetaExtractInput, MetaExtractOutput } from './config';
import { config } from './config';

const systemPrompt = Prompt.empty()
  .with(
    'Role & Goal',
    'You are a document analysis assistant. Analyze the document content and extract metadata.',
  )
  .with(
    'Categories',
    `Categories and their metadata fields:
- tech_blog: platform (发布平台), techStack (技术栈数组)
- social_media: platform (来源平台), author (作者), publishedAt (发布时间)
- paper: authors (作者数组), venue (会议/期刊), year (年份)
- documentation: library (库名), version (版本)
- news: source (来源), publishedAt (发布时间), region (地区)
- other: 自由发挥`,
  )
  .with(
    'Output Format',
    `Respond ONLY with valid JSON in this exact format:
{
  "title": "文档标题",
  "summary": "一句话摘要（不超过50字）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "category": "分类（tech_blog/social_media/paper/documentation/news/other）",
  "metadata": {
    // 根据分类提取对应字段
  }
}`,
  );

@tool(ToolIds.DOCUMENT_METADATA_EXTRACT)
export default class MetaExtractTool extends Tool<
  MetaExtractInput,
  MetaExtractOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: MetaExtractInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, MetaExtractOutput, void> {
    const { content, sourceUrl, sourceType } = data;

    // Truncate content if too long (keep first 8000 chars)
    const truncatedContent =
      content.length > 8000 ? content.slice(0, 8000) : content;

    const userPrompt = `Analyze this document:
${sourceUrl ? `Source URL: ${sourceUrl}\n` : ''}${sourceType ? `Source Type: ${sourceType}\n` : ''}

Document Content:
${truncatedContent}`;

    yield ctx.agentToolProgressEvent(this.id, {
      message: `Analyzing document content (${Math.round(truncatedContent.length / 1024)}KB) via LLM...`,
      data: { sourceUrl, sourceType },
    });

    const responseContent = yield* ctx.callLlm({
      messages: [
        { role: 'system', content: systemPrompt.build() },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    if (!responseContent) {
      throw new Error(
        'LLM returned empty response when extracting metadata. ' +
          'This may be due to: (1) content too short or empty, (2) content in unsupported language, ' +
          '(3) LLM service temporarily unavailable. ' +
          'Try: provide longer content, or check LLM service status.',
      );
    }

    let parsed: MetaExtractOutput;
    try {
      parsed = JSON.parse(responseContent);
    } catch {
      this.logger.error('Failed to parse LLM response:', responseContent);
      throw new Error(
        `Failed to parse LLM response as JSON. ` +
          `The LLM may have returned malformed output. ` +
          `Try: (1) retry the operation, (2) use a different model with better JSON formatting, ` +
          `(3) check if content contains special characters that confuse the model. ` +
          `Response preview: ${responseContent?.slice(0, 100)}...`,
      );
    }

    // Validate and provide defaults
    const output: MetaExtractOutput = {
      title: parsed.title || 'Untitled',
      summary: parsed.summary?.slice(0, 50) || '',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      category: parsed.category || 'other',
      metadata: parsed.metadata || {},
    };

    yield ctx.agentToolProgressEvent(this.id, {
      message: `Extracted: "${output.title}" (${output.category})`,
      data: {
        title: output.title,
        category: output.category,
        keywordCount: output.keywords.length,
      },
    });

    return output;
  }
}

export { config };
