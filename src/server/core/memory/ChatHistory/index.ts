import { memory } from '@/server/decorator/core';
import { TraceContext } from '@/server/core/TraceContext';
import { ConversationService } from '@/server/service/ConversationService';
import { Logger } from '@/server/utils/logger';
import { MemoryIds } from '@/shared/constants';
import { Message, Role } from '@/shared/types/entities';
import dayjs from 'dayjs';
import { inject } from 'tsyringe';
import { Memory, InitializeInput } from '..';

@memory(MemoryIds.CHAT_HISTORY)
export default class ChatHistoryMemory extends Memory {
  protected readonly logger!: Logger;

  private get conversationId(): string {
    const id = TraceContext.get()?.conversationId;
    if (!id) {
      throw new Error(
        'ChatHistoryMemory requires conversationId in TraceContext',
      );
    }
    return id;
  }

  private get userId(): string {
    return TraceContext.get()?.userId ?? '';
  }

  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {
    super();
  }

  async initialize(input: InitializeInput): Promise<void> {
    const history = await this.summarize();
    const isNewConversation = history.length === 0;
    // Use current time as base, with 1ms increment per message to ensure correct ordering
    const baseTime = Date.now();
    const messages: Message[] = [];

    if (isNewConversation) {
      // Add system prompt
      if (input.systemPrompt) {
        messages.push({
          id: '',
          role: Role.SYSTEM,
          content: input.systemPrompt,
          attachments: null,
          meta: null,
          createdAt: new Date(baseTime + messages.length),
          conversationId: this.conversationId,
        });
      }

      // Add session context
      const sessionContext = `<session-context>
Conversation ID: ${this.conversationId}
User ID: ${this.userId}
Current Time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}
</session-context>`;

      messages.push({
        id: '',
        role: Role.USER,
        content: sessionContext,
        attachments: null,
        meta: { hidden: true },
        createdAt: new Date(baseTime + messages.length),
        conversationId: this.conversationId,
      });

      // Add context
      if (input.context) {
        messages.push({
          id: '',
          role: Role.USER,
          content: input.context,
          attachments: null,
          meta: { hidden: true },
          createdAt: new Date(baseTime + messages.length),
          conversationId: this.conversationId,
        });
      }
    }

    // Add user message
    messages.push({
      id: '',
      ...input.userMessage,
      createdAt: new Date(baseTime + messages.length),
      conversationId: this.conversationId,
    });

    await this.store(messages);

    this.logger.debug('ChatHistoryMemory initialized', {
      isNewConversation,
      messageCount: messages.length,
    });
  }

  async store(messages: Message[]): Promise<void> {
    await this.conversationService.batchAddMessages(
      this.conversationId,
      messages,
    );
  }

  async retrieve(): Promise<Message[]> {
    return this.conversationService.getMessagesByConversationId(
      this.conversationId,
    );
  }

  async clearByConversationId(conversationId: string): Promise<void> {
    await this.conversationService.batchDeleteMessagesInConversation(
      conversationId,
    );
  }

  async clearByUserId(_userId: string): Promise<void> {
    throw new Error('ChatHistoryMemory does not support clearByUserId');
  }

  async summarize(): Promise<Message[]> {
    const result = await this.conversationService.getMessagesByConversationId(
      this.conversationId,
    );

    if (result[result.length - 1]?.role === Role.ASSIST) {
      // messages[len-1] is the streaming assist message
      result.splice(result.length - 1, 1);
    }

    return result;
  }
}
