import { describe, it, expect } from 'vitest';
import { Entity, AggregateRoot, createDomainEvent } from '@/server/libs/ddd';

class TestEntity extends Entity<string> {
  constructor(id: string) {
    super(id);
  }
}

class TestAggregate extends AggregateRoot<string> {
  constructor(id: string) {
    super(id);
  }

  doAction(detail: string): void {
    this.addEvent(createDomainEvent('action_done', this.id, { detail }));
  }

  doAnotherAction(): void {
    this.addEvent(createDomainEvent('another_action', this.id, null));
  }
}

describe('Entity', () => {
  it('should compare by id', () => {
    const a = new TestEntity('id_1');
    const b = new TestEntity('id_1');
    const c = new TestEntity('id_2');

    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('should return false for undefined', () => {
    const entity = new TestEntity('id_1');
    expect(entity.equals(undefined)).toBe(false);
  });
});

describe('AggregateRoot', () => {
  it('should collect domain events', () => {
    const aggregate = new TestAggregate('agg_1');
    expect(aggregate.domainEvents).toHaveLength(0);

    aggregate.doAction('test');
    expect(aggregate.domainEvents).toHaveLength(1);

    const event = aggregate.domainEvents[0];
    expect(event.type).toBe('action_done');
    expect(event.aggregateId).toBe('agg_1');
    expect(event.payload).toEqual({ detail: 'test' });
    expect(event.occurredAt).toBeGreaterThan(0);
  });

  it('should accumulate multiple events', () => {
    const aggregate = new TestAggregate('agg_1');
    aggregate.doAction('first');
    aggregate.doAnotherAction();

    expect(aggregate.domainEvents).toHaveLength(2);
    expect(aggregate.domainEvents[0].type).toBe('action_done');
    expect(aggregate.domainEvents[1].type).toBe('another_action');
  });

  it('should clear events', () => {
    const aggregate = new TestAggregate('agg_1');
    aggregate.doAction('test');

    aggregate.clearEvents();
    expect(aggregate.domainEvents).toHaveLength(0);
  });

  it('should extend Entity (inherits equals)', () => {
    const a = new TestAggregate('agg_1');
    const b = new TestAggregate('agg_1');
    expect(a.equals(b)).toBe(true);
  });
});

describe('createDomainEvent', () => {
  it('should create typed event', () => {
    const event = createDomainEvent('run_completed', 'run_1', {
      tokenCount: 42,
    });

    expect(event.type).toBe('run_completed');
    expect(event.aggregateId).toBe('run_1');
    expect(event.payload.tokenCount).toBe(42);
    expect(event.occurredAt).toBeGreaterThan(0);
  });
});
