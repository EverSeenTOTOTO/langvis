import type { Message } from '@/shared/types/entities';
import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import Logger from '@/server/utils/logger';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { MESSAGE_REPOSITORY } from '../conversation.di-tokens';
import type { MessageRepositoryPort } from '../database/message.repository.port';
import { StartChatTurnCommand } from './start-chat-turn.command';
import { prepareTurn } from './chat-preparation.factory';

export interface StartChatTurnResult {
  messages: Message[];
  assistantId: string;
  assistantMessage: Message;
}

@service()
export class StartChatTurnHandler {
  private readonly logger = Logger.child({ source: 'StartChatTurnHandler' });

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
  ) {}

  async execute(command: StartChatTurnCommand): Promise<StartChatTurnResult> {
    const { conversationId, userId, systemPrompt, context, userMessage } =
      command;

    const existingMessages =
      await this.messageRepo.findByConversationId(conversationId);
    const isFirstTurn = existingMessages.length === 0;

    const workDir = isFirstTurn
      ? await this.workspaceService.getWorkDir(conversationId)
      : '';

    const { newMessages, assistantId, assistantMessage } = prepareTurn({
      isFirstTurn,
      systemPrompt,
      userId,
      workDir,
      context,
      userMessage,
      assistantId: command.assistantId,
    });

    // Stamp conversationId onto all new messages
    for (const msg of newMessages) {
      msg.conversationId = conversationId;
    }

    this.messageRepo.batchCreate(conversationId, newMessages).catch(err => {
      this.logger.error('Failed to persist turn messages', err);
    });

    return {
      messages: [...existingMessages, ...newMessages.slice(0, -1)],
      assistantId,
      assistantMessage,
    };
  }
}
