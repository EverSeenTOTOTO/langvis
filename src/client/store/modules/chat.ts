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
import type { StreamFrame } from '@/shared/types/events';

@store()
export class ChatStore {
  private messageNodes = new Map<string, Map<string, MessageNode>>();
  private transports = new Map<string, SSEClientTransport>();
  private connectingPromises = new Map<string, Promise<void>>();

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
        audio: msg.audio ?? undefined,
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
      await this.ensureConnected(conversationId);
    } catch {
      this.refreshMessages(conversationId);
    }
  }

  // ════════════════════════════════════════
  // SSE Transport
  // ════════════════════════════════════════

  /** 确保会话 SSE 信道在线：已连则 no-op，否则（重连 /activate）重新激活 memory。
   *  即“激活状态”的无感检查——transport 活性 ⟺ session 活着 ⟺ memory 在位。 */
  async ensureConnected(conversationId: string): Promise<void> {
    if (this.transports.get(conversationId)?.isConnected) return;
    // 切换 currentConversationId 的 reaction、发送前、标签页重新可见时都可能并发进入；
    // 复用同一次连接 Promise，避免对同一会话建立两条 SSE。
    const pending = this.connectingPromises.get(conversationId);
    if (pending) return pending;

    const transport = new SSEClientTransport(
      `/api/chat/activate/${conversationId}`,
    );
    this.transports.set(conversationId, transport);
    this.setupTransportListeners(conversationId, transport);

    const connectPromise = transport.connect();
    this.connectingPromises.set(conversationId, connectPromise);
    try {
      await connectPromise;
    } finally {
      this.connectingPromises.delete(conversationId);
    }
  }

  private setupTransportListeners(
    conversationId: string,
    transport: SSEClientTransport,
  ): void {
    transport.addEventListener('message', (e: CustomEvent) => {
      const frame = e.detail as StreamFrame;

      if (frame.type === 'connected') return;

      if (frame.type === 'conversation_usage') {
        this.conversationStore.conversationUsage = {
          used: frame.used,
          total: frame.total,
        };
        return;
      }

      if (frame.type === 'loop_usage') {
        this.conversationStore.loopUsage.set(frame.runId, {
          used: frame.used,
          total: frame.total,
        });
        return;
      }

      // 投影帧 → 整体替换 MessageNode 状态（实时 / 重连 / 历史同此一帧）
      if (frame.type === 'run_view') {
        const node = this.messageNodes
          .get(conversationId)
          ?.get(frame.messageId);
        if (!node) return;
        const wasTerminal = node.isTerminal;
        node.applyView(frame);
        // 终态由 run_view.status 承载（final/cancelled/error 不再单独成帧）：
        // 转入终态时刷新消息（取回持久化 content/meta），并清掉该 run 的瞬态用量。
        if (!wasTerminal && node.isTerminal) {
          this.conversationStore.loopUsage.delete(frame.runId);
          this.refreshMessages(conversationId);
        }
        return;
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

    // 发送前确保会话已激活：长 idle 后 SSE 静默断开、服务端 session 已被 idle 回收，
    // 此处重连 /activate 重新激活 memory（已连则 no-op）。连不上则 fail-clean，不盲发。
    try {
      await this.ensureConnected(conversationId);
    } catch {
      antMessage.error(this.settingStore.tr('Failed to connect to SSE'));
      this.refreshMessages(conversationId);
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
    this.connectingPromises.delete(oldId);
    this.messageNodes.delete(oldId);
  }
}
