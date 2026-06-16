import { container, Lifecycle } from 'tsyringe';
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
} from './conversation.di-tokens';
import { MessageRepository } from './infrastructure/persistence/message.repository';
import { ConversationRepository } from './infrastructure/persistence/conversation.repository';

container.register(MESSAGE_REPOSITORY, MessageRepository, {
  lifecycle: Lifecycle.Singleton,
});
container.register(CONVERSATION_REPOSITORY, ConversationRepository, {
  lifecycle: Lifecycle.Singleton,
});

import './application/command/conversation-activate.handler';
import './application/command/cancel-chat.handler';
import './application/command/start-chat.handler';
import './application/query/get-session-state.handler';
import './application/event/complete-turn.handler';
