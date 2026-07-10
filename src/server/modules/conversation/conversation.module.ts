import { container, Lifecycle } from 'tsyringe';
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
  HUMAN_INPUT_PORT,
} from './conversation.di-tokens';
import { MessageRepository } from './infrastructure/persistence/message.repository';
import { ConversationRepository } from './infrastructure/persistence/conversation.repository';
import { HumanInputRedisProvider } from './infrastructure/human-input.redis.provider';

container.register(MESSAGE_REPOSITORY, MessageRepository, {
  lifecycle: Lifecycle.Singleton,
});
container.register(CONVERSATION_REPOSITORY, ConversationRepository, {
  lifecycle: Lifecycle.Singleton,
});
container.register(HUMAN_INPUT_PORT, HumanInputRedisProvider);

import './application/command/conversation-activate.handler';
import './application/command/create-conversation.handler';
import './application/command/conversation-update.handler';
import './application/command/cancel-chat.handler';
import './application/command/start-chat.handler';
import './application/query/get-session-state.handler';
import './application/query/get-messages.handler';
import './application/query/get-run-view.handler';
import './application/service/history-config.fragment';
import './application/event/run-started.handler';
import './application/event/run-event.handler';
import './application/event/complete-turn.handler';
import './application/service/orphan-run-reconciler';
import './application/transforms';
