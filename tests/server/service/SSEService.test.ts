import { SSEService } from '@/server/service/SSEService';
import { container } from 'tsyringe';
import { vi } from 'vitest';

describe('SSEService', () => {
  let sseService: SSEService;

  beforeEach(() => {
    sseService = container.resolve(SSEService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('should be defined', () => {
    expect(sseService).toBeDefined();
  });

  describe('sendMessage', () => {
    it('should throw an error by default', () => {
      expect(() => sseService.sendMessage('test_event', {})).toThrow(
        'SSE not connect',
      );
    });

    it('should not throw an error after setting a sender', () => {
      const sender = vi.fn();
      sseService.setSendMessage(sender);
      expect(() => sseService.sendMessage('test_event', {})).not.toThrow();
      expect(sender).toHaveBeenCalledWith('test_event', {});
    });
  });
});
