import { EmailService } from '@/server/service/EmailService';
import pg from '@/server/service/pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/service/pg', () => ({
  default: {
    getRepository: vi.fn(),
  },
}));

vi.mock('@/shared/utils', () => ({
  generateId: vi.fn(prefix => `${prefix}_test123`),
  isTest: vi.fn(() => true),
}));

describe('EmailService', () => {
  let emailService: EmailService;
  let mockRepository: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = {
      findAndCount: vi.fn(),
      findOneBy: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(pg.getRepository).mockReturnValue(mockRepository as any);
    emailService = new EmailService();
  });

  describe('list', () => {
    it('should list emails with default pagination', async () => {
      const mockEmails = [
        { id: 'mail_1', subject: 'Test Email', from: 'test@example.com' },
      ];
      mockRepository.findAndCount.mockResolvedValueOnce([mockEmails, 1]);

      const result = await emailService.list({});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('should apply filters correctly', async () => {
      mockRepository.findAndCount.mockResolvedValueOnce([[], 0]);

      await emailService.list({
        from: 'sender@test.com',
        subject: 'test subject',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        page: 2,
        pageSize: 10,
      });

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          order: { sentAt: 'DESC' },
        }),
      );
    });

    it('should use fuzzy search for from field', async () => {
      mockRepository.findAndCount.mockResolvedValueOnce([[], 0]);

      await emailService.list({ from: 'john' });

      const callArgs = mockRepository.findAndCount.mock.calls[0][0];
      expect(callArgs.where.from).toBeDefined();
      // TypeORM Like wraps the value with % for fuzzy match
      expect(callArgs.where.from._value).toBe('%john%');
    });

    it('should use fuzzy search for subject field', async () => {
      mockRepository.findAndCount.mockResolvedValueOnce([[], 0]);

      await emailService.list({ subject: 'meeting' });

      const callArgs = mockRepository.findAndCount.mock.calls[0][0];
      expect(callArgs.where.subject).toBeDefined();
      expect(callArgs.where.subject._value).toBe('%meeting%');
    });

    it('should combine multiple fuzzy filters', async () => {
      mockRepository.findAndCount.mockResolvedValueOnce([[], 0]);

      await emailService.list({ from: 'john', subject: 'meeting' });

      const callArgs = mockRepository.findAndCount.mock.calls[0][0];
      expect(callArgs.where.from._value).toBe('%john%');
      expect(callArgs.where.subject._value).toBe('%meeting%');
    });
  });

  describe('getById', () => {
    it('should return email by id', async () => {
      const mockEmail = { id: 'mail_1', subject: 'Test' };
      mockRepository.findOneBy.mockResolvedValueOnce(mockEmail);

      const result = await emailService.getById('mail_1');

      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 'mail_1' });
      expect(result).toEqual(mockEmail);
    });

    it('should return null if not found', async () => {
      mockRepository.findOneBy.mockResolvedValueOnce(null);

      const result = await emailService.getById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('existsByMessageId', () => {
    it('should return true if email exists', async () => {
      mockRepository.count.mockResolvedValueOnce(1);

      const result = await emailService.existsByMessageId('msg123');

      expect(result).toBe(true);
    });

    it('should return false if email does not exist', async () => {
      mockRepository.count.mockResolvedValueOnce(0);

      const result = await emailService.existsByMessageId('msg123');

      expect(result).toBe(false);
    });
  });

  describe('archive', () => {
    it('should archive new email successfully', async () => {
      mockRepository.count.mockResolvedValueOnce(0);
      mockRepository.create.mockReturnValueOnce({
        id: 'mail_test123',
        messageId: 'msg123',
      });
      mockRepository.save.mockResolvedValueOnce({
        id: 'mail_test123',
        messageId: 'msg123',
      });

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
      mockRepository.count.mockResolvedValueOnce(1);

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
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should extract attachment names from raw data', async () => {
      mockRepository.count.mockResolvedValueOnce(0);
      mockRepository.create.mockImplementation((data: unknown) => data);
      mockRepository.save.mockImplementation((data: unknown) =>
        Promise.resolve(data),
      );

      await emailService.archive({
        messageId: 'msg123',
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        sentAt: new Date(),
        receivedAt: new Date(),
        content: 'Content',
        raw: {
          'attachment-1': 'file1.pdf',
          'attachment-2': 'file2.png',
        },
      });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          attachmentNames: ['file1.pdf', 'file2.png'],
        }),
      );
    });

    it('should handle archive errors', async () => {
      mockRepository.count.mockResolvedValueOnce(0);
      mockRepository.create.mockReturnValueOnce({});
      mockRepository.save.mockRejectedValueOnce(new Error('Database error'));

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
      mockRepository.delete.mockResolvedValueOnce({ affected: 1 });

      const result = await emailService.delete('mail_1');

      expect(result).toBe(true);
    });

    it('should return false if email not found', async () => {
      mockRepository.delete.mockResolvedValueOnce({ affected: 0 });

      const result = await emailService.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('updateStatus', () => {
    it('should update email status to archived', async () => {
      const mockEmail = {
        id: 'mail_1',
        status: 'unarchived',
        archivedAt: null,
      };
      mockRepository.findOneBy.mockResolvedValueOnce(mockEmail);
      mockRepository.save.mockResolvedValueOnce({
        ...mockEmail,
        status: 'archived',
        archivedAt: expect.any(Date),
      });

      const result = await emailService.updateStatus('mail_1', 'archived');

      expect(result.success).toBe(true);
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'archived',
          archivedAt: expect.any(Date),
        }),
      );
    });

    it('should return false if email not found', async () => {
      mockRepository.findOneBy.mockResolvedValueOnce(null);

      const result = await emailService.updateStatus('nonexistent', 'archived');

      expect(result.success).toBe(false);
    });
  });

  describe('list with status filter', () => {
    it('should filter by status', async () => {
      mockRepository.findAndCount.mockResolvedValueOnce([[], 0]);

      await emailService.list({ status: 'archived' });

      const callArgs = mockRepository.findAndCount.mock.calls[0][0];
      expect(callArgs.where.status).toBe('archived');
    });
  });
});
