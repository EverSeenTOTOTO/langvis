import type { Request } from 'express';

// 认证能力抽象接口：封装 session 验证 + 用户获取，消费者只依赖此接口。
export interface AuthPort {
  /** 获取当前请求的 session，未认证时返回 null */
  getSession(req: Request): Promise<any | null>;

  /** 获取 session ID，未认证时抛 Error */
  getSessionId(req: Request): Promise<string>;

  /** 获取当前请求的用户，未认证时返回 null */
  getUser(req: Request): Promise<any | null>;

  /** 获取当前请求的用户 ID，未认证时抛 Error */
  getUserId(req: Request): Promise<string>;

  /** 判断请求是否已认证 */
  isAuthenticated(req: Request): Promise<boolean>;
}
