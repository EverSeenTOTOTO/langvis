// 认证能力抽象接口：封装 session 验证 + 用户获取，消费者只依赖此接口。
// 入参为 cookie 头字符串——HTTP 语义在边界（guard/中间件）提取，端口不感知 express。
export interface AuthPort {
  /** 获取当前 session，未认证时返回 null */
  getSession(cookie: string): Promise<any | null>;

  /** 获取 session ID，未认证时抛 Error */
  getSessionId(cookie: string): Promise<string>;

  /** 获取当前用户，未认证时返回 null */
  getUser(cookie: string): Promise<any | null>;

  /** 获取当前用户 ID，未认证时抛 Error */
  getUserId(cookie: string): Promise<string>;

  /** 判断是否已认证 */
  isAuthenticated(cookie: string): Promise<boolean>;
}
