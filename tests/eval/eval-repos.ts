/**
 * eval 用的"真够用"in-memory 仓库桩（**模块级单例 + 原地清空**）。
 *
 * 为什么不用 noop：summary-attach（conv turn-start）读 agentRunRepo.findByIds 取
 * processSummary，compact-transform（conv turn-end）写 messageRepo.batchCreate——
 * noop 让这两条压缩链路静默盲掉（G1.1 要让四条压缩机制都可观测）。
 *
 * 为什么是单例 + 原地清空：conv transform（SummaryAttachTransform / CompactTransform）是
 * @singleton，构造时经 DI 捕获 repo 引用——容器只解析一次。故 eval 必须复用同一 repo
 * **对象**，reset 时清空其内部 Map（而非换对象），否则 transform 仍指着旧引用。
 * 对象在 registerEvalRepos() 首次创建并登记入容器，之后保持不变。
 */
import type { AgentRun, Message } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import { generateId } from '@/shared/utils';

// 模块级存储——单例复用，clear() 原地清空（不换对象）。
const runStore = new Map<string, AgentRun>();
const messageStore = new Map<string, Message>();

let convId = '';
let _agentRunRepo: AgentRunRepositoryPort | undefined;
let _messageRepo: MessageRepositoryPort | undefined;

/** 清空两仓内部存储（对象引用不变），标记本次 run 的 conversationId。 */
export function resetEvalRepos(conversationId: string): void {
  runStore.clear();
  messageStore.clear();
  convId = conversationId;
}

export const evalConversationId = () => convId;

/** 首次创建单例 repo 对象（仅 registerEvalRepos 调一次）。 */
export function buildEvalRepos(): {
  agentRunRepo: AgentRunRepositoryPort;
  messageRepo: MessageRepositoryPort;
} {
  if (_agentRunRepo && _messageRepo) {
    return { agentRunRepo: _agentRunRepo, messageRepo: _messageRepo };
  }
  _agentRunRepo = {
    save: async r => {
      runStore.set(r.id, r);
      return r;
    },
    findById: async id => runStore.get(id) ?? null,
    findByIds: async ids =>
      ids.map(id => runStore.get(id)).filter((r): r is AgentRun => !!r),
    findNonTerminal: async () =>
      [...runStore.values()].filter(
        r => r.status === 'initialized' || r.status === 'running',
      ),
    update: async (id, partial) => {
      const cur = runStore.get(id);
      if (!cur) return null;
      const next = { ...cur, ...partial };
      runStore.set(id, next);
      return next;
    },
  };
  _messageRepo = {
    batchCreate: async (cId, data) =>
      data.map(d => {
        const m: Message = {
          id: d.id ?? generateId('msg'),
          role: d.role,
          content: d.content,
          attachments: d.attachments ?? null,
          meta: d.meta ?? null,
          createdAt: d.createdAt ?? new Date(),
          conversationId: cId,
        };
        messageStore.set(m.id, m);
        return m;
      }),
    findLastAssistantMessage: async () => {
      for (let i = messageStore.size - 1; i >= 0; i--) {
        const m = [...messageStore.values()][i]!;
        if (m.role === Role.ASSIST) return m;
      }
      return null;
    },
    findById: async id => messageStore.get(id) ?? null,
    findByConversationId: async () => [...messageStore.values()],
    findByAgentRunIds: async runIds => {
      const set = new Set(runIds);
      return [...messageStore.values()].filter(
        m => !!m.agentRunId && set.has(m.agentRunId),
      );
    },
    save: async m => {
      messageStore.set(m.id, m);
      return m;
    },
    batchDeleteInConversation: async (_cId, ids) => {
      for (const id of ids ?? [...messageStore.keys()]) messageStore.delete(id);
    },
    update: async (id, partial) => {
      const cur = messageStore.get(id);
      if (!cur) return null;
      const next = { ...cur, ...partial };
      messageStore.set(id, next);
      return next;
    },
    deleteAfter: async () => true,
  };
  return { agentRunRepo: _agentRunRepo, messageRepo: _messageRepo };
}
