import { describe, it, expect } from 'vitest';
import { ExceptionBase } from '@/server/libs/exceptions/exception.base';

class TestDomainError extends ExceptionBase {
  readonly code = 'TEST_DOMAIN_ERROR';
}

class AnotherDomainError extends ExceptionBase {
  readonly code = 'ANOTHER_DOMAIN_ERROR';
}

describe('ExceptionBase', () => {
  describe('constructor', () => {
    it('should set message', () => {
      const error = new TestDomainError('Something went wrong');
      expect(error.message).toBe('Something went wrong');
    });

    it('should set name to constructor name', () => {
      const error = new TestDomainError('test');
      expect(error.name).toBe('TestDomainError');
    });

    it('should set code from subclass definition', () => {
      const error = new TestDomainError('test');
      expect(error.code).toBe('TEST_DOMAIN_ERROR');
    });

    it('should set correlationId when provided', () => {
      const error = new TestDomainError('test', 'corr-123');
      expect(error.correlationId).toBe('corr-123');
    });

    it('should leave correlationId undefined when not provided', () => {
      const error = new TestDomainError('test');
      expect(error.correlationId).toBeUndefined();
    });
  });

  describe('instanceof checks', () => {
    it('should be instanceof ExceptionBase', () => {
      expect(new TestDomainError('test')).toBeInstanceOf(ExceptionBase);
    });

    it('should be instanceof Error', () => {
      expect(new TestDomainError('test')).toBeInstanceOf(Error);
    });

    it('should distinguish between subclasses', () => {
      const error = new TestDomainError('test');
      expect(error).toBeInstanceOf(TestDomainError);
      expect(error).not.toBeInstanceOf(AnotherDomainError);
    });
  });

  describe('stack trace', () => {
    it('should have a stack trace containing the class name', () => {
      const error = new TestDomainError('test');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('TestDomainError');
    });
  });
});
