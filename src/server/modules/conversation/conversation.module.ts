import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ChatController } from './chat.controller';
import { ConversationController } from './conversation.controller';
import { ConversationGroupController } from './conversation-group.controller';
import { ConversationActivateHandler } from './application/command/conversation-activate.handler';
import { CreateConversationHandler } from './application/command/create-conversation.handler';
import { ConversationUpdateHandler } from './application/command/conversation-update.handler';
import { CancelChatHandler } from './application/command/cancel-chat.handler';
import { StartChatHandler } from './application/command/start-chat.handler';
import { TruncateChatHandler } from './application/command/truncate-chat.handler';
import { GetSessionStateHandler } from './application/query/get-session-state.handler';
import { GetMessagesHandler } from './application/query/get-messages.handler';
import { GetConversationsByWorkspaceHandler } from './application/query/get-conversations-by-workspace.handler';
import { GetRunViewHandler } from './application/query/get-run-view.handler';
import { RunStartedHandler } from './application/event/run-started.handler';
import { RunEventHandler } from './application/event/run-event.handler';
import { CompleteTurnHandler } from './application/event/complete-turn.handler';
import { ChatService } from './application/service/chat.service';
import { SessionManager } from './application/service/session-manager';
import { RunViewCache } from './application/service/run-view-cache';
import { OrphanRunReconciler } from './application/service/orphan-run-reconciler';
import { MessageRepository } from './infrastructure/persistence/message.repository';
import { ConversationRepository } from './infrastructure/persistence/conversation.repository';
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
} from './conversation.di-tokens';
import { AgentModule } from '@/server/modules/agent/agent.module';
import { ConvTransformPlan } from './domain/model/conv-transform';
import { CONV_TRANSFORM_PLAN } from './application/transforms';
import { ProcessSummaryTransform } from './application/transforms/process-summary-transform';
import { ReconstructTransform } from './application/transforms/reconstruct-transform';
import { SummarizeTransform } from './application/transforms/summarize-transform';
import { UsageTransform } from './application/transforms/usage-transform';

@Module({
  imports: [CqrsModule, AgentModule],
  controllers: [
    ChatController,
    ConversationController,
    ConversationGroupController,
  ],
  providers: [
    MessageRepository,
    { provide: MESSAGE_REPOSITORY, useExisting: MessageRepository },
    ConversationRepository,
    { provide: CONVERSATION_REPOSITORY, useExisting: ConversationRepository },
    ChatService,
    SessionManager,
    RunViewCache,
    OrphanRunReconciler,
    ProcessSummaryTransform,
    ReconstructTransform,
    SummarizeTransform,
    UsageTransform,
    {
      provide: CONV_TRANSFORM_PLAN,
      useFactory: (
        processSummary: ProcessSummaryTransform,
        reconstruct: ReconstructTransform,
        summarize: SummarizeTransform,
        usage: UsageTransform,
      ) =>
        new ConvTransformPlan([processSummary, reconstruct, summarize, usage]),
      inject: [
        ProcessSummaryTransform,
        ReconstructTransform,
        SummarizeTransform,
        UsageTransform,
      ],
    },
    ConversationActivateHandler,
    CreateConversationHandler,
    ConversationUpdateHandler,
    CancelChatHandler,
    StartChatHandler,
    TruncateChatHandler,
    GetSessionStateHandler,
    GetMessagesHandler,
    GetConversationsByWorkspaceHandler,
    GetRunViewHandler,
    RunStartedHandler,
    RunEventHandler,
    CompleteTurnHandler,
  ],
})
export class ConversationModule {}
