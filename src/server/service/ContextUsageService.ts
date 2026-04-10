import { singleton } from 'tsyringe';

export interface ContextUsage {
  used: number; // estimateTokens 返回值
  total: number; // ProviderService.getModel(id).contextSize
}

@singleton()
export class ContextUsageService {
  private storage = new Map<string, ContextUsage>();

  get(conversationId: string): ContextUsage | undefined {
    return this.storage.get(conversationId);
  }

  set(conversationId: string, usage: ContextUsage): void {
    this.storage.set(conversationId, usage);
  }

  delete(conversationId: string): void {
    this.storage.delete(conversationId);
  }

  clear(): void {
    this.storage.clear();
  }

  getAll(): Map<string, ContextUsage> {
    return new Map(this.storage);
  }
}
