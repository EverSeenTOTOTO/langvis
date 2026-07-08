import { inject } from 'tsyringe';
import { CACHE_PORT } from '@/server/modules/agent/agent.di-tokens';
import type {
  CachePort,
  CachedReference,
} from '@/server/modules/agent/domain/port/cache.port';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { service } from '@/server/decorator/service';

export interface ArchivePromptInput {
  conversationId: string;
  subject: string;
  from: string;
  fromName: string | null;
  sentAt: string;
  content: string;
}

/** Composes the `/document_archive` user prompt for a just-archived email.
 *  Owns the prompt template (subject / sender / time + inline-vs-cached body)
 *  and the body-caching step, so the EmailArchived reaction stays a thin
 *  dispatcher instead of carrying use-case logic. */
@service()
export class EmailArchivePromptService {
  constructor(
    @inject(CACHE_PORT)
    private readonly cache: CachePort,
    @inject(WorkspaceService)
    private readonly workspace: WorkspaceService,
  ) {}

  async compose(input: ArchivePromptInput): Promise<string> {
    const workDir = await this.workspace.getWorkDir(input.conversationId);
    const contentOrCached = (await this.cache.compress(
      workDir,
      input.content,
    )) as string | CachedReference;
    return this.formatPrompt(input, contentOrCached);
  }

  private formatPrompt(
    input: ArchivePromptInput,
    contentOrCached: string | CachedReference,
  ): string {
    const fromDisplay = input.fromName
      ? `${input.fromName} <${input.from}>`
      : input.from;

    if (typeof contentOrCached === 'string') {
      return `/document_archive 归档邮件：${input.subject}\n\n发件人：${fromDisplay}\n发件时间：${input.sentAt}\n\n内容：\n${contentOrCached}`;
    }

    return `/document_archive 归档邮件：${input.subject}\n\n发件人：${fromDisplay}\n发件时间：${input.sentAt}\n\n内容已缓存：${JSON.stringify(contentOrCached)}`;
  }
}
