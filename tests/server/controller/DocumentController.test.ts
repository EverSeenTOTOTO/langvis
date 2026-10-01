import { describe, it, beforeEach, vi, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { DocumentController } from '@/server/modules/document/document.controller';

const mockDocumentService = {
  listDocuments: vi.fn(),
  getDocumentById: vi.fn(),
  deleteDocument: vi.fn(),
};

const mockReq = (userId?: string) =>
  ({ user: userId ? { id: userId } : undefined }) as Request;

const expectHttpError = async (
  promise: Promise<unknown>,
  status: number,
  body: Record<string, unknown>,
) => {
  const err = (await promise.catch(e => e)) as HttpException;
  expect(err).toBeInstanceOf(HttpException);
  expect(err.getStatus()).toBe(status);
  expect(err.getResponse()).toMatchObject(body);
};

describe('DocumentController', () => {
  let controller: DocumentController;

  beforeEach(() => {
    controller = new DocumentController(mockDocumentService as never);
  });

  it('listDocuments 未认证抛 401', async () => {
    await expectHttpError(
      controller.listDocuments({} as never, mockReq()),
      401,
      { error: 'Unauthorized' },
    );
  });

  it('listDocuments 透传过滤条件', async () => {
    const result = { items: [], total: 0 };
    mockDocumentService.listDocuments!.mockResolvedValue(result);
    await expect(
      controller.listDocuments(
        { keyword: 'k', page: 1, pageSize: 10 } as never,
        mockReq('u1'),
      ),
    ).resolves.toBe(result);
    expect(mockDocumentService.listDocuments).toHaveBeenCalledWith({
      keyword: 'k',
      page: 1,
      pageSize: 10,
    });
  });

  it('getDocumentById 命中返回文档', async () => {
    const doc = { id: 'd1' };
    mockDocumentService.getDocumentById!.mockResolvedValue(doc);
    await expect(controller.getDocumentById('d1', mockReq('u1'))).resolves.toBe(
      doc,
    );
  });

  it('getDocumentById 未命中抛 404', async () => {
    mockDocumentService.getDocumentById!.mockResolvedValue(null);
    await expectHttpError(
      controller.getDocumentById('nope', mockReq('u1')),
      404,
      { error: 'Document not found' },
    );
  });

  it('deleteDocument 成功返回 success', async () => {
    mockDocumentService.deleteDocument!.mockResolvedValue(true);
    await expect(
      controller.deleteDocument('d1', mockReq('u1')),
    ).resolves.toEqual({ success: true });
  });

  it('deleteDocument 未命中抛 404', async () => {
    mockDocumentService.deleteDocument!.mockResolvedValue(false);
    await expectHttpError(
      controller.deleteDocument('nope', mockReq('u1')),
      404,
      {
        error: 'Document not found',
      },
    );
  });
});
