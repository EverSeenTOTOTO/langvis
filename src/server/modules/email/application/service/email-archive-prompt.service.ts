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
 *  Owns the prompt template (subject / sender / time + inline body). The body
 *  goes in raw — if it blows the context, the pre-LLM offload hook pages it
 *  out to disk the same as any other large seed message, so email needs no
 *  special caching here. Keeps EmailArchived a thin dispatcher. */
@service()
export class EmailArchivePromptService {
  async compose(input: ArchivePromptInput): Promise<string> {
    const fromDisplay = input.fromName
      ? `${input.fromName} <${input.from}>`
      : input.from;
    return `/document_archive 归档邮件：${input.subject}\n\n发件人：${fromDisplay}\n发件时间：${input.sentAt}\n\n内容：\n${input.content}`;
  }
}
