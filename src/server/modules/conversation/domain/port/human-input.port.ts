/**
 * HumanInputPort — 人机交互输入能力抽象接口。
 *
 * 封装 pending request 的原子提交和状态查询，
 * 不暴露 Redis / Lua script 等基础设施细节。
 */
export interface HumanInputPort {
  /**
   * 原子提交用户输入。
   * Returns: 'not_found' | 'already_submitted' | 'success'
   */
  submit(
    messageId: string,
    data: Record<string, unknown>,
  ): Promise<'not_found' | 'already_submitted' | 'success'>;

  /** 获取 pending request 的状态（是否存在、是否已提交、消息和 schema） */
  getStatus(messageId: string): Promise<{
    exists: boolean;
    submitted: boolean;
    message: string;
    schema: unknown;
  } | null>;
}
