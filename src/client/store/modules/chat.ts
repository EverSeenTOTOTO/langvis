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
import { message as antMessage } from 'antd';
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
        if (oldId) {
          this.cleanupOldSessions(oldId);
        }

        if (!newId) return;

        await this.conversationStore.getMessagesByConversationId({ id: newId });
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

      session.addEventListener('dispose', () => {
        this.sessions.delete(conversationId);
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
    const conversationId = params.conversationId;

    if (!conversationId) {
      antMessage.error(
        this.settingStore.tr('Failed to create or get conversation'),
      );
      return;
    }

    const session = this.acquireSession(conversationId);

    // Add optimistic user message for immediate UI feedback
    this.addOptimisticUserMessage(conversationId, params.content!);

    try {
      await session.connect();
    } catch {
      this.refreshMessages(conversationId);
      return;
    }

    try {
      const res = (await req!.send()) as StartChatResponse;

      // Create assistant message entity with real ID from backend
      if (res.messageId) {
        this.addAssistantMessage(conversationId, res.messageId);

        // Create MessageFSM for the new assistant message
        const messages = this.conversationStore.messages[conversationId];
        const assistantMessage = messages?.find(m => m.id === res.messageId);
        if (assistantMessage) {
          session.createMessageFSM(res.messageId, assistantMessage);
        }
      }
    } catch {
      this.refreshMessages(conversationId);
    }
  }

  private refreshMessages(conversationId: string): void {
    this.conversationStore.getMessagesByConversationId({ id: conversationId });
  }

  private addOptimisticUserMessage(
    conversationId: string,
    content: string,
  ): void {
    const existingMessages =
      this.conversationStore.messages[conversationId] ?? [];

    this.conversationStore.messages[conversationId] = [
      ...existingMessages,
      {
        id: generateId('msg'),
        conversationId,
        role: Role.USER,
        content,
        createdAt: new Date(),
      },
    ];
  }

  private addAssistantMessage(
    conversationId: string,
    assistantId: string,
  ): void {
    const existingMessages =
      this.conversationStore.messages[conversationId] ?? [];

    this.conversationStore.messages[conversationId] = [
      ...existingMessages,
      {
        id: assistantId,
        conversationId,
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
      },
    ];
  }

  private cleanupOldSessions(oldId: string): void {
    const session = this.sessions.get(oldId);
    if (session) {
      session.deactivate();
      this.sessions.delete(oldId);
    }
  }
}
