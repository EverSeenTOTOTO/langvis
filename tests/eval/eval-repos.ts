// eval 用"真够用"in-memory 仓库桩（模块级单例 + 原地清空）：noop 会让 summary-attach/
// compact 两条压缩链路静默盲掉；单例复用同一 repo 对象，reset 只清内部 Map，供 transform 引用。
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
