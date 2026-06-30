/**
 * Entity — 领域实体基类，通过 ID 判等。
 * TypeORM 持久化模型（MessageEntity 等）不继承此类——它们是持久化模型，不是领域实体。
 */
export abstract class Entity<TId> {
  readonly id: TId;

  constructor(id: TId) {
    this.id = id;
  }

  equals(other?: Entity<TId>): boolean {
    if (!other) return false;
    return this.id === other.id;
  }
}
