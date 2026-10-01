// TransactionPort — 事务边界端口：单一事务内执行 work，实现侧把 mgr 装进 ALS，repo 据此分流到事务 mgr。
// 业务侧只包一个 transaction()，不传 mgr、repo 调用原样。
export interface TransactionPort {
  /** 在单一事务内执行 work；work 内 repo 调用自动绑同一 mgr（ambient）。work 抛错即回滚并重抛。 */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_PORT = Symbol('TRANSACTION_PORT');
