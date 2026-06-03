import { container, Lifecycle } from 'tsyringe';
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
} from './conversation.di-tokens';
import { MessageRepository } from './database/message.repository';
import { ConversationRepository } from './database/conversation.repository';

container.register(MESSAGE_REPOSITORY, MessageRepository, {
  lifecycle: Lifecycle.Singleton,
});
container.register(CONVERSATION_REPOSITORY, ConversationRepository, {
  lifecycle: Lifecycle.Singleton,
});

import './handlers';
