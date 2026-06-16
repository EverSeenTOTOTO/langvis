import { EmailService } from '@/server/modules/email/application/email.service';
import type { EmailRepositoryPort } from '@/server/modules/email/database/email.repository.port';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/utils', () => ({
  generateId: vi.fn(prefix => `${prefix}_test123`),
  isTest: vi.fn(() => true),
}));

const mockRepo = {
  list: vi.fn(),
  getById: vi.fn(),
  getByMessageId: vi.fn(),
  existsByMessageId: vi.fn(),
  save: vi.fn(),
  deleteById: vi.fn(),
  updateStatus: vi.fn(),
} as unknown as EmailRepositoryPort;

describe('EmailService', () => {
  let emailService: EmailService;

  beforeEach(() => {
    vi.clearAllMocks();
    emailService = new EmailService(mockRepo);
  });

  describe('list', () => {
    it('should list emails with default pagination', async () => {
      const mockEmails = [
        { id: 'mail_1', subject: 'Test Email', from: 'test@example.com' },
      ];
      vi.mocked(mockRepo.list).mockResolvedValueOnce({
        items: mockEmails as any,
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await emailService.list({});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('should delegate filters to repository', async () => {
      vi.mocked(mockRepo.list).mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 2,
        pageSize: 10,
      });

      const params = {
        from: 'sender@test.com',
        subject: 'test subject',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        page: 2,
        pageSize: 10,
      };
      await emailService.list(params);

      expect(mockRepo.list).toHaveBeenCalledWith(params);
    });
  });

  describe('getById', () => {
    it('should return email by id', async () => {
      const mockEmail = { id: 'mail_1', subject: 'Test' };
      vi.mocked(mockRepo.getById).mockResolvedValueOnce(mockEmail as any);

      const result = await emailService.getById('mail_1');

      expect(mockRepo.getById).toHaveBeenCalledWith('mail_1');
      expect(result).toEqual(mockEmail);
    });

    it('should return null if not found', async () => {
      vi.mocked(mockRepo.getById).mockResolvedValueOnce(null);

      const result = await emailService.getById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('existsByMessageId', () => {
    it('should return true if email exists', async () => {
      vi.mocked(mockRepo.existsByMessageId).mockResolvedValueOnce(true);

      const result = await emailService.existsByMessageId('msg123');

      expect(result).toBe(true);
    });

    it('should return false if email does not exist', async () => {
      vi.mocked(mockRepo.existsByMessageId).mockResolvedValueOnce(false);

      const result = await emailService.existsByMessageId('msg123');

      expect(result).toBe(false);
    });
  });

  describe('archive', () => {
    it('should archive new email successfully', async () => {
      vi.mocked(mockRepo.existsByMessageId).mockResolvedValueOnce(false);
      vi.mocked(mockRepo.save).mockResolvedValueOnce({
        id: 'mail_test123',
        messageId: 'msg123',
      } as any);

      const result = await emailService.archive({
        messageId: 'msg123',
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        sentAt: new Date(),
        receivedAt: new Date(),
        content: 'Test content',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('mail_test123');
    });

    it('should skip if email already archived', async () => {
      vi.mocked(mockRepo.existsByMessageId).mockResolvedValueOnce(true);

      const result = await emailService.archive({
        messageId: 'existing-msg',
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        sentAt: new Date(),
        receivedAt: new Date(),
        content: 'Content',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeUndefined();
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('should handle archive errors', async () => {
      vi.mocked(mockRepo.existsByMessageId).mockResolvedValueOnce(false);
      vi.mocked(mockRepo.save).mockRejectedValueOnce(
        new Error('Database error'),
      );

      const result = await emailService.archive({
        messageId: 'msg123',
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        sentAt: new Date(),
        receivedAt: new Date(),
        content: 'Content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('delete', () => {
    it('should delete email successfully', async () => {
      vi.mocked(mockRepo.deleteById).mockResolvedValueOnce(true);

      const result = await emailService.delete('mail_1');

      expect(result).toBe(true);
    });

    it('should return false if email not found', async () => {
      vi.mocked(mockRepo.deleteById).mockResolvedValueOnce(false);

      const result = await emailService.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('updateStatus', () => {
    it('should update email status to archived', async () => {
      vi.mocked(mockRepo.updateStatus).mockResolvedValueOnce(true);

      const result = await emailService.updateStatus('mail_1', 'archived');

      expect(result.success).toBe(true);
      expect(mockRepo.updateStatus).toHaveBeenCalledWith('mail_1', 'archived');
    });

    it('should return false if email not found', async () => {
      vi.mocked(mockRepo.updateStatus).mockResolvedValueOnce(false);

      const result = await emailService.updateStatus('nonexistent', 'archived');

      expect(result.success).toBe(false);
    });
  });
});
