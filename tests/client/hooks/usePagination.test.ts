/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { usePagination } from '@/client/hooks/usePagination';

interface TestFilters {
  keyword?: string;
  category?: string;
}

describe('usePagination', () => {
  const mockFetchFn = vi.fn();

  beforeEach(() => {
    mockFetchFn.mockReset();
    mockFetchFn.mockResolvedValue({
      items: [{ id: 1 }, { id: 2 }],
      total: 100,
      page: 1,
      pageSize: 10,
    });
  });

  it('should return initial state correctly', () => {
    const { result } = renderHook(() =>
      usePagination<TestFilters>({
        fetchFn: mockFetchFn,
        defaultFilters: { keyword: 'test' },
        defaultPageSize: 20,
        immediate: false,
      }),
    );

    expect(result.current.dataSource).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.filters).toEqual({ keyword: 'test' });
    expect(result.current.pagination.current).toBe(1);
    expect(result.current.pagination.pageSize).toBe(20);
  });

  it('should fetch data immediately when immediate is true', async () => {
    renderHook(() =>
      usePagination<TestFilters>({
        fetchFn: mockFetchFn,
        immediate: true,
      }),
    );

    expect(mockFetchFn).toHaveBeenCalledTimes(1);
    expect(mockFetchFn).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 10 }),
    );
  });

  it('should not fetch data when immediate is false', () => {
    renderHook(() =>
      usePagination<TestFilters>({
        fetchFn: mockFetchFn,
        immediate: false,
      }),
    );

    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it('search should update filters and reset to page 1', async () => {
    const { result } = renderHook(() =>
      usePagination<TestFilters>({
        fetchFn: mockFetchFn,
        immediate: false,
      }),
    );

    await act(async () => {
      result.current.search({ keyword: 'new search', category: 'tech' });
    });

    expect(result.current.filters).toEqual({
      keyword: 'new search',
      category: 'tech',
    });
    expect(result.current.pagination.current).toBe(1);
    expect(mockFetchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: 'new search',
        category: 'tech',
        page: 1,
      }),
    );
  });

  it('reset should restore default values', async () => {
    const { result } = renderHook(() =>
      usePagination<TestFilters>({
        fetchFn: mockFetchFn,
        defaultFilters: { keyword: 'default' },
        defaultPageSize: 15,
        immediate: false,
      }),
    );

    await act(async () => {
      result.current.search({ keyword: 'changed' });
    });

    await act(async () => {
      result.current.reset();
    });

    expect(result.current.filters).toEqual({ keyword: 'default' });
    expect(result.current.pagination.current).toBe(1);
    expect(result.current.pagination.pageSize).toBe(15);
  });

  it('refresh should refetch with current params', async () => {
    const { result } = renderHook(() =>
      usePagination<TestFilters>({
        fetchFn: mockFetchFn,
        immediate: false,
      }),
    );

    await act(async () => {
      result.current.search({ keyword: 'test' });
    });

    mockFetchFn.mockClear();

    await act(async () => {
      result.current.refresh();
    });

    expect(mockFetchFn).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'test', page: 1 }),
    );
  });

  it('pagination.onChange should update page', async () => {
    const { result } = renderHook(() =>
      usePagination<TestFilters>({
        fetchFn: mockFetchFn,
        immediate: false,
      }),
    );

    mockFetchFn.mockClear();

    await act(async () => {
      result.current.pagination.onChange!(2, 10);
    });

    expect(result.current.pagination.current).toBe(2);
    expect(mockFetchFn).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it('changing pageSize should reset to page 1', async () => {
    const { result } = renderHook(() =>
      usePagination<TestFilters>({
        fetchFn: mockFetchFn,
        immediate: false,
      }),
    );

    await act(async () => {
      result.current.pagination.onChange!(3, 10);
    });

    expect(result.current.pagination.current).toBe(3);

    mockFetchFn.mockClear();

    await act(async () => {
      result.current.pagination.onChange!(1, 20);
    });

    expect(result.current.pagination.current).toBe(1);
    expect(result.current.pagination.pageSize).toBe(20);
    expect(mockFetchFn).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });
});
