import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig, ToolEvent } from '@/shared/types';
import { container } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Prompt } from '../../PromptBuilder';
import type LlmCallTool from '../LlmCall';
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
- other: 无额外字段`,
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

@tool(ToolIds.META_EXTRACT)
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
  ): AsyncGenerator<ToolEvent, MetaExtractOutput, void> {
    const { content, sourceUrl, sourceType } = data;

    // Truncate content if too long (keep first 8000 chars)
    const truncatedContent =
      content.length > 8000 ? content.slice(0, 8000) : content;

    const userPrompt = `Analyze this document:
${sourceUrl ? `Source URL: ${sourceUrl}\n` : ''}${sourceType ? `Source Type: ${sourceType}\n` : ''}

Document Content:
${truncatedContent}`;

    const llmCallTool = container.resolve<LlmCallTool>(ToolIds.LLM_CALL);

    const responseContent = yield* llmCallTool.call(
      {
        messages: [
          { role: 'system', content: systemPrompt.build() },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      },
      ctx,
    );

    if (!responseContent) {
      throw new Error('No response from LLM');
    }

    let parsed: MetaExtractOutput;
    try {
      parsed = JSON.parse(responseContent);
    } catch {
      this.logger.error('Failed to parse LLM response:', responseContent);
      throw new Error('Failed to parse LLM response as JSON');
    }

    // Validate and provide defaults
    const output: MetaExtractOutput = {
      title: parsed.title || 'Untitled',
      summary: parsed.summary?.slice(0, 50) || '',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      category: parsed.category || 'other',
      metadata: parsed.metadata || {},
    };

    yield ctx.toolResultEvent(this.id, output);
    return output;
  }
}

export { config };
