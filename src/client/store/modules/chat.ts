import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  CancelChatRequest,
  GetHumanInputStatusRequest,
  GetHumanInputStatusResponse,
  StartChatRequest,
  StartChatResponse,
  SubmitHumanInputRequest,
} from '@/shared/dto/controller';
import { Role } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import { message } from 'antd';
import { makeAutoObservable, reaction } from 'mobx';
import { inject } from 'tsyringe';
import { SessionFSM } from './SessionFSM';
import { ConversationStore } from './conversation';
import { SettingStore } from './setting';

@store()
export class ChatStore {
  private sessions = new Map<string, SessionFSM>();

  constructor(
    @inject(ConversationStore) private conversationStore: ConversationStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
    makeAutoObservable(this);

    reaction(
      () => this.conversationStore.currentConversationId,
      async (newId, oldId) => {
        // Cleanup old sessions to limit memory
        if (oldId) {
          this.cleanupOldSessions(oldId);
        }

        if (!newId) return;

        await this.conversationStore.getMessagesByConversationId({ id: newId });
        // Initialize FSM for all assistant messages
        this.initializeMessageFSMs(newId);
        await this.activateConversation(newId);
      },
    );
  }

  @api('/api/chat/session/:conversationId')
  async getSessionState(
    _params: { conversationId: string },
    req?: ApiRequest<{ conversationId: string }>,
  ): Promise<{ phase: 'waiting' | 'running' | 'done' } | null> {
    return req!.send() as Promise<{
      phase: 'waiting' | 'running' | 'done';
    } | null>;
  }

  async activateConversation(conversationId: string): Promise<void> {
    const state = await this.getSessionState({ conversationId });

    if (!state || state.phase === 'done') return;

    const session = this.acquireSession(conversationId);
    try {
      await session.connect();
    } catch {
      this.refreshMessages(conversationId);
    }
  }

  getSession(conversationId: string): SessionFSM | undefined {
    return this.sessions.get(conversationId);
  }

  acquireSession(conversationId: string): SessionFSM {
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = new SessionFSM(conversationId);

      session.addEventListener('message', (e: CustomEvent) => {
        const event = e.detail;
        if (event.type === 'context_usage') {
          this.conversationStore.contextUsage = {
            used: event.used,
            total: event.total,
          };
        }

        if (
          event.type === 'final' ||
          event.type === 'cancelled' ||
          event.type === 'error'
        ) {
          this.refreshMessages(conversationId);
        }
      });

      session.addEventListener('transition', (e: CustomEvent) => {
        const { to } = e.detail;
        if (to === 'error') {
          this.refreshMessages(conversationId);
        }
      });

      const conversation =
        this.conversationStore.findConversationById(conversationId);
      if (conversation) {
        session.setConversation(conversation);
      }
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  get currentSession(): SessionFSM | undefined {
    const conversationId = this.conversationStore.currentConversationId;
    if (!conversationId) return undefined;
    return this.sessions.get(conversationId);
  }

  @api('/api/chat/cancel/:conversationId', {
    method: 'post',
  })
  async cancelChat(
    params: CancelChatRequest,
    req?: ApiRequest<CancelChatRequest>,
  ) {
    const session = this.getSession(params.conversationId);
    if (!session) return;

    await session.cancelConversation(async () => {
      await req!.send();
    });
  }

  @api('/api/human-input/:messageId', { method: 'post' })
  async submitHumanInput(
    _params: SubmitHumanInputRequest,
    req?: ApiRequest<SubmitHumanInputRequest>,
  ) {
    return await req!.send();
  }

  @api('/api/human-input/:messageId')
  async getHumanInputStatus(
    _params: GetHumanInputStatusRequest,
    req?: ApiRequest<GetHumanInputStatusRequest>,
  ): Promise<GetHumanInputStatusResponse> {
    return req!.send();
  }

  @api('/api/chat/start/:conversationId', {
    method: 'post',
  })
  async startChat(
    params: StartChatRequest,
    req?: ApiRequest<StartChatRequest>,
  ) {
    const conversationId = this.conversationStore.currentConversationId;

    if (!conversationId) {
      message.error(
        this.settingStore.tr('Failed to create or get conversation'),
      );
      return;
    }

    const session = this.acquireSession(conversationId);

    // Add temporary optimistic messages for immediate UI feedback
    const tempAssistantId = generateId('msg');
    this.addPendingMessages(
      conversationId,
      params.content!,
      generateId('msg'),
      tempAssistantId,
    );

    // Create MessageFSM for the initialized assistant message
    const messages = this.conversationStore.messages[conversationId];
    const assistantMessage = messages?.[messages.length - 1];
    if (assistantMessage && assistantMessage.id === tempAssistantId) {
      session.createMessageFSM(tempAssistantId, assistantMessage);
    }

    try {
      await session.connect();
    } catch {
      this.refreshMessages(conversationId);
      return;
    }

    try {
      const res = (await req!.send()) as StartChatResponse;

      // Replace temporary assistant message ID with the real one from backend
      if (res.messageId) {
        this.replaceAssistantMessageId(
          conversationId,
          tempAssistantId,
          res.messageId,
        );
        // Update MessageFSM with new ID
        session.removeMessageFSM(tempAssistantId);
        const updatedMessages = this.conversationStore.messages[conversationId];
        const updatedAssistant = updatedMessages?.[updatedMessages.length - 1];
        if (updatedAssistant && updatedAssistant.id === res.messageId) {
          const fsm = session.createMessageFSM(res.messageId, updatedAssistant);
          fsm.start();
        }
      }
    } catch {
      this.refreshMessages(conversationId);
    }
  }

  // Initialize FSMs for all assistant messages in a conversation
  private initializeMessageFSMs(conversationId: string): void {
    const session = this.acquireSession(conversationId);
    const messages = this.conversationStore.messages[conversationId];

    if (!messages) return;

    for (const msg of messages) {
      if (msg.role === Role.ASSIST) {
        session.restoreMessageFSM(msg);
      }
    }
  }

  private refreshMessages(conversationId: string): void {
    this.conversationStore.getMessagesByConversationId({ id: conversationId });
  }

  private addPendingMessages(
    conversationId: string,
    userContent: string,
    userId?: string,
    assistantId?: string,
  ): void {
    const existingMessages =
      this.conversationStore.messages[conversationId] ?? [];

    // Create new array to trigger MobX reactivity
    this.conversationStore.messages[conversationId] = [
      ...existingMessages,
      {
        id: userId ?? generateId('msg'),
        conversationId,
        role: Role.USER,
        content: userContent,
        createdAt: new Date(),
      },
      {
        id: assistantId ?? generateId('msg'),
        conversationId,
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
      },
    ];
  }

  private replaceAssistantMessageId(
    conversationId: string,
    oldId: string,
    newId: string,
  ): void {
    const messages = this.conversationStore.messages[conversationId];
    if (!messages) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.id === oldId) {
      lastMessage.id = newId;
    }
  }

  // Deactivate and remove old session
  private cleanupOldSessions(oldId: string): void {
    const session = this.sessions.get(oldId);
    if (session) {
      session.deactivate();
      this.sessions.delete(oldId);
    }
  }
}
