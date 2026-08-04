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
import { notifier as antMessage } from '../../notifier';
import { makeAutoObservable, reaction, runInAction } from 'mobx';
import { inject } from 'tsyringe';
import { MessageNode } from './message-node';
import { SSEClientTransport } from './transport/SSEClientTransport';
import { ConversationStore } from './conversation';
import { SettingStore } from './setting';
import type { Message } from '@/shared/types/entities';
import type { StreamFrame } from '@/shared/types/events';

type RunViewFrame = Extract<StreamFrame, { type: 'run_view' }>;

@store()
export class ChatStore {
  private messageNodes = new Map<string, Map<string, MessageNode>>();
  private transports = new Map<string, SSEClientTransport>();
  private connectingPromises = new Map<string, Promise<void>>();
  // run_view 帧经 SSE 与 POST 并发早到，而节点要等 POST 返回才创建。直接丢帧会让
  // "到达即阻塞的 ask_user"丢失 awaitingInput 而卡死 thinking——这里按 messageId 暂存最近一帧，建好节点后再补灌。
  private readonly pendingRunViews = new Map<string, RunViewFrame>();

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

        // usage is a per-active-conversation field; reset so a fresh conv doesn't
        // keep the previous conv's usage until its own activate frame lands.
        runInAction(() => {
          this.conversationStore.conversationUsage = null;
        });

        // Activate (transport → 'connecting') in parallel with loading history,
        // so "activating…" paints instead of waiting for the long full-list render.
        const load = this.loadMessages(newId);
        await this.activateConversation(newId);
        await load;
      },
    );
  }

  // ═══ Computed ═══

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

  // SSE (re)connecting = transport-liveness activation; a leftover running node doesn't count.
  get isTransportConnecting(): boolean {
    const id = this.conversationStore.currentConversationId;
    if (!id) return false;
    return this.transports.get(id)?.isConnecting ?? false;
  }

  // ═══ MessageNode access ═══

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
    // makeAutoObservable deep-converts the nested Map on insert, so the stored
    // proxy differs from the `new Map()`; all reads/writes must target it.
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
      // 节点建好于 run 之后（POST 返回）——补灌暂存的最新投影帧，别让阻塞的 ask_user 丢帧。
      const pending = this.pendingRunViews.get(msg.id);
      if (pending) {
        this.pendingRunViews.delete(msg.id);
        this.applyToNode(conversationId, pending);
      }
    }
    return node;
  }

  // 把一帧 run_view 应用到已存在的节点；转入终态时刷新消息并清掉该 run 的瞬态用量。
  private applyToNode(conversationId: string, frame: RunViewFrame): void {
    const node = this.messageNodes.get(conversationId)?.get(frame.messageId);
    if (!node) return;
    const wasTerminal = node.isTerminal;
    node.applyView(frame);
    // 终态由 run_view.status 承载（final/cancelled/error 不再单独成帧）：
    // 转入终态时刷新消息（取回持久化 content/meta），并清掉该 run 的瞬态用量。
    if (!wasTerminal && node.isTerminal) {
      this.conversationStore.loopUsage.delete(frame.runId);
      this.refreshMessages(conversationId);
    }
  }

  // ═══ Conversation lifecycle ═══

  async activateConversation(conversationId: string): Promise<void> {
    this.ensureAssistantNodes(conversationId);

    try {
      await this.ensureConnected(conversationId);
    } catch {
      this.refreshMessages(conversationId);
    }
  }

  // ═══ SSE Transport ═══

  // 已连则 no-op，否则重连 /activate 重新激活 memory（transport 活性 ⟺ session 活着）。
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
        // 节点未建（POST 返回前）时先暂存，建好后再补灌——避免丢帧卡死 thinking。
        if (!this.messageNodes.get(conversationId)?.has(frame.messageId)) {
          this.pendingRunViews.set(frame.messageId, frame);
          return;
        }
        this.applyToNode(conversationId, frame);
        return;
      }
    });

    transport.addEventListener('disconnect', () => {
      this.refreshMessages(conversationId);
    });
  }

  // ═══ API methods ═══

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

  @api('/api/human-input/:runId', { method: 'post' })
  async submitHumanInput(
    _params: SubmitHumanInputRequest,
    req?: ApiRequest<SubmitHumanInputRequest>,
  ) {
    return await req!.send();
  }

  @api('/api/human-input/:runId')
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

    // Echo the user's message before activation, so a slow activate/replay
    // doesn't make the submit look like a no-op.
    this.addOptimisticUserMessage(conversationId, params.content!);

    // After long idle the SSE channel drops and the server reclaims the
    // session — reconnect /activate (no-op if connected) before sending.
    try {
      await this.ensureConnected(conversationId);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      antMessage.error(
        `${this.settingStore.tr('Failed to connect to SSE')} (${reason})`,
      );
      this.refreshMessages(conversationId);
      return;
    }

    try {
      const res = (await req!.send()) as StartChatResponse;

      if (res.messageId) {
        this.addAssistantMessage(conversationId, res.messageId);
      }
    } catch {
      this.refreshMessages(conversationId);
    }
  }

  // ═══ Private helpers ═══

  private refreshMessages(conversationId: string): void {
    void this.loadMessages(conversationId);
  }

  // Publish messages + assistant nodes atomically; the view must never see a node-less assistant.
  private async loadMessages(conversationId: string): Promise<void> {
    const messages = await this.conversationStore.fetchMessages({
      id: conversationId,
    });
    runInAction(() => {
      this.conversationStore.messages[conversationId] = messages;
      this.ensureAssistantNodes(conversationId);
    });
  }

  // Ensure a MessageNode exists for each assistant message. Idempotent — skips existing.
  private ensureAssistantNodes(conversationId: string): void {
    const messages = this.conversationStore.messages[conversationId] ?? [];
    for (const msg of messages) {
      if (msg.role !== Role.ASSIST) continue;
      this.getOrCreateMessageNode(conversationId, msg);
    }
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

    const msg: Message = {
      id: assistantId,
      conversationId,
      role: Role.ASSIST,
      content: '',
      status: 'initialized',
      createdAt: new Date(),
    };

    this.conversationStore.messages[conversationId] = [
      ...existingMessages,
      msg,
    ];

    // Create the node in the same action as the message append (we're outside
    // the original action batch), so the view never renders a node-less message.
    this.getOrCreateMessageNode(conversationId, msg);
  }

  private cleanupConversation(oldId: string): void {
    const transport = this.transports.get(oldId);
    if (transport) {
      transport.close();
      this.transports.delete(oldId);
    }
    this.connectingPromises.delete(oldId);
    this.messageNodes.delete(oldId);
    this.pendingRunViews.clear();
  }
}
