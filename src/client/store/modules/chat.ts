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
import { MessageNode } from './message-node';
import { SSEClientTransport } from './transport/SSEClientTransport';
import { ConversationStore } from './conversation';
import { SettingStore } from './setting';
import type { Message } from '@/shared/types/entities';
import type { SSEFrame } from '@/shared/types/events';

@store()
export class ChatStore {
  private messageNodes = new Map<string, Map<string, MessageNode>>();
  private transports = new Map<string, SSEClientTransport>();

  constructor(
    @inject(ConversationStore) private conversationStore: ConversationStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
    makeAutoObservable(this);

    reaction(
      () => this.conversationStore.currentConversationId,
      async (newId, oldId) => {
        if (oldId) {
          this.cleanupConversation(oldId);
        }

        if (!newId) return;

        await this.conversationStore.getMessagesByConversationId({ id: newId });
        await this.activateConversation(newId);
      },
    );
  }

  // ════════════════════════════════════════
  // Computed
  // ════════════════════════════════════════

  get currentSessionActive(): boolean {
    const id = this.conversationStore.currentConversationId;
    if (!id) return false;
    const nodes = this.messageNodes.get(id);
    const transport = this.transports.get(id);
    const connecting = transport?.isConnecting ?? false;
    const hasRunning = Array.from(nodes?.values() ?? []).some(
      n => n.status === 'running',
    );
    return connecting || hasRunning;
  }

  // ════════════════════════════════════════
  // MessageNode access
  // ════════════════════════════════════════

  getMessageNode(
    conversationId: string,
    messageId: string,
  ): MessageNode | undefined {
    return this.messageNodes.get(conversationId)?.get(messageId);
  }

  private getOrCreateMessageNode(
    conversationId: string,
    msg: Message,
  ): MessageNode {
    if (!this.messageNodes.has(conversationId)) {
      this.messageNodes.set(conversationId, new Map());
    }
    // Re-read from the observable map: makeAutoObservable deep-converts the
    // nested Map on insert, so the stored value is a proxy distinct from the
    // `new Map()` we just created. All reads/writes must target that proxy,
    // or getMessageNode (which reads via this.messageNodes.get) won't see them.
    const nodes = this.messageNodes.get(conversationId)!;

    let node = nodes.get(msg.id);
    if (!node) {
      node = new MessageNode({
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role,
        createdAt: msg.createdAt,
        content: msg.content,
        status: msg.status as any,
        steps: msg.steps ?? undefined,
        audio:
          (msg.meta?.audio as
            | { filePath: string; voice?: string }
            | undefined) ?? undefined,
      });
      nodes.set(msg.id, node);
    }
    return node;
  }

  // ════════════════════════════════════════
  // Conversation lifecycle
  // ════════════════════════════════════════

  async activateConversation(conversationId: string): Promise<void> {
    const messages = this.conversationStore.messages[conversationId] ?? [];

    // Create MessageNodes for all assistant messages
    for (const msg of messages) {
      if (msg.role !== Role.ASSIST) continue;
      this.getOrCreateMessageNode(conversationId, msg);
    }

    try {
      await this.connectTransport(conversationId);
    } catch {
      this.refreshMessages(conversationId);
    }
  }

  // ════════════════════════════════════════
  // SSE Transport
  // ════════════════════════════════════════

  private async connectTransport(conversationId: string): Promise<void> {
    let transport = this.transports.get(conversationId);
    if (transport?.isConnected) return;

    transport = new SSEClientTransport(`/api/chat/activate/${conversationId}`);
    this.transports.set(conversationId, transport);

    this.setupTransportListeners(conversationId, transport);

    await transport.connect();
  }

  private setupTransportListeners(
    conversationId: string,
    transport: SSEClientTransport,
  ): void {
    transport.addEventListener('message', (e: CustomEvent) => {
      const frame = e.detail as SSEFrame;

      if (frame.type === 'connected') return;

      if (frame.type === 'context_usage') {
        this.conversationStore.contextUsage = {
          used: frame.used,
          total: frame.total,
        };
        return;
      }

      // State snapshot → initialize MessageNode from server state
      if (frame.type === 'state_snapshot') {
        const msgId = (frame as any).messageId as string;
        if (msgId) {
          const node = this.messageNodes.get(conversationId)?.get(msgId);
          if (node) {
            node.applySnapshot(frame as any);
          }
        }
        return;
      }

      // Terminal events → refresh messages from server
      if (
        frame.type === 'final' ||
        frame.type === 'cancelled' ||
        frame.type === 'error'
      ) {
        this.refreshMessages(conversationId);
      }

      // Route to MessageNode
      const msgId = (frame as any).messageId as string;
      if (msgId) {
        const node = this.messageNodes.get(conversationId)?.get(msgId);
        if (node) node.handleFrame(frame);
      }
    });

    transport.addEventListener('disconnect', () => {
      this.refreshMessages(conversationId);
    });
  }

  // ════════════════════════════════════════
  // API methods
  // ════════════════════════════════════════

  @api('/api/chat/session/:conversationId')
  async getSessionState(
    _params: { conversationId: string },
    req?: ApiRequest<{ conversationId: string }>,
  ): Promise<{ phase: 'waiting' | 'running' | 'done' } | null> {
    return req!.send() as Promise<{
      phase: 'waiting' | 'running' | 'done';
    } | null>;
  }

  @api('/api/chat/cancel/:conversationId', {
    method: 'post',
  })
  async cancelChat(
    _params: CancelChatRequest,
    req?: ApiRequest<CancelChatRequest>,
  ) {
    await req!.send();
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

    // Add optimistic user message for immediate UI feedback
    this.addOptimisticUserMessage(conversationId, params.content!);

    try {
      const res = (await req!.send()) as StartChatResponse;

      if (res.messageId) {
        this.addAssistantMessage(conversationId, res.messageId);

        const messages = this.conversationStore.messages[conversationId];
        const assistantMessage = messages?.find(m => m.id === res.messageId);
        if (assistantMessage) {
          this.getOrCreateMessageNode(conversationId, assistantMessage);
        }
      }
    } catch {
      this.refreshMessages(conversationId);
    }
  }

  // ════════════════════════════════════════
  // Private helpers
  // ════════════════════════════════════════

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
        status: 'initialized',
        createdAt: new Date(),
      },
    ];
  }

  private cleanupConversation(oldId: string): void {
    const transport = this.transports.get(oldId);
    if (transport) {
      transport.close();
      this.transports.delete(oldId);
    }
    this.messageNodes.delete(oldId);
  }
}
