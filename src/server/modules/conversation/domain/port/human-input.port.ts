/** 人机交互输入能力抽象——封装 pending request 的原子提交与状态查询，不暴露 Redis / Lua 细节。 */
export interface HumanInputPort {
  submit(
    messageId: string,
    data: Record<string, unknown>,
  ): Promise<'not_found' | 'already_submitted' | 'success'>;

  getStatus(messageId: string): Promise<{
    exists: boolean;
    submitted: boolean;
    message: string;
    schema: unknown;
  } | null>;
}
