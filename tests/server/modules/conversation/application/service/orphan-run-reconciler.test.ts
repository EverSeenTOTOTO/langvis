import { describe, it, expect, vi } from 'vitest';
import { OrphanRunReconciler } from '@/server/modules/conversation/application/service/orphan-run-reconciler';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';

function makeMockChat(count: number): ChatService {
  return {
    markInterruptedRuns: vi.fn().mockResolvedValue(count),
  } as unknown as ChatService;
}

describe('OrphanRunReconciler（启动清扫）', () => {
  it('onBoot 以重启文案清扫孤儿 run', async () => {
    const chat = makeMockChat(3);
    const reconciler = new OrphanRunReconciler(chat);

    await reconciler.onBoot();

    expect(chat.markInterruptedRuns).toHaveBeenCalledWith(
      'Generation interrupted (server restarted)',
    );
  });

  it('无孤儿时同样调用（内部早返），不抛错', async () => {
    const chat = makeMockChat(0);
    const reconciler = new OrphanRunReconciler(chat);

    await expect(reconciler.onBoot()).resolves.toBeUndefined();
    expect(chat.markInterruptedRuns).toHaveBeenCalledTimes(1);
  });
});
