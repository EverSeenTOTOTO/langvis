import { useCallback, useEffect, useRef, useState } from 'react';
import { useAsyncFn } from 'react-use';
import type { TablePaginationConfig } from 'antd/es/table';

export interface PaginationResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UsePaginationOptions<TFilters extends Record<string, any>> {
  /** API 调用函数 */
  fetchFn: (
    params: TFilters & { page: number; pageSize: number },
  ) => Promise<PaginationResponse<any> | undefined>;
  /** 默认搜索条件 */
  defaultFilters?: TFilters;
  /** 默认分页大小 */
  defaultPageSize?: number;
  /** 是否立即执行 */
  immediate?: boolean;
}

export interface UsePaginationReturn<TFilters, TItem> {
  /** 数据列表，可直接传给 Table dataSource */
  dataSource: TItem[];
  /** 分页配置，可直接传给 Table pagination */
  pagination: TablePaginationConfig;
  /** 当前生效的搜索条件 */
  filters: TFilters;
  /** 加载状态 */
  loading: boolean;
  /** 刷新当前页 */
  refresh: () => void;
  /** 搜索（更新 filters 并重置到第一页） */
  search: (filters: TFilters) => void;
  /** 重置（恢复默认 filters 和分页） */
  reset: () => void;
  /** 错误 */
  error?: Error;
}

export function usePagination<
  TFilters extends Record<string, any>,
  TItem = any,
>(
  options: UsePaginationOptions<TFilters>,
): UsePaginationReturn<TFilters, TItem> {
  const {
    fetchFn,
    defaultFilters = {} as TFilters,
    defaultPageSize = 10,
    immediate = true,
  } = options;

  const [, forceUpdate] = useState(0);

  const paramsRef = useRef({
    page: 1,
    pageSize: defaultPageSize,
    filters: defaultFilters,
  });

  const [state, fetchData] = useAsyncFn(
    async (params: TFilters & { page: number; pageSize: number }) => {
      return fetchFn(params);
    },
    [fetchFn],
  );

  const refresh = useCallback(() => {
    const { filters, page, pageSize } = paramsRef.current;
    fetchData({ ...filters, page, pageSize });
  }, [fetchData]);

  const search = useCallback(
    (newFilters: TFilters) => {
      paramsRef.current.filters = newFilters;
      paramsRef.current.page = 1;
      forceUpdate(n => n + 1);
      refresh();
    },
    [refresh],
  );

  const reset = useCallback(() => {
    paramsRef.current = {
      page: 1,
      pageSize: defaultPageSize,
      filters: defaultFilters,
    };
    forceUpdate(n => n + 1);
    refresh();
  }, [defaultFilters, defaultPageSize, refresh]);

  const handlePaginationChange = useCallback(
    (page: number, pageSize: number) => {
      paramsRef.current.page =
        pageSize !== paramsRef.current.pageSize ? 1 : page;
      paramsRef.current.pageSize = pageSize;
      forceUpdate(n => n + 1);
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    if (immediate) {
      refresh();
    }
  }, []);

  const { page, pageSize, filters } = paramsRef.current;

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total: state.value?.total ?? 0,
    onChange: handlePaginationChange,
    showSizeChanger: true,
    showQuickJumper: true,
  };

  return {
    dataSource: state.value?.items ?? [],
    pagination,
    filters,
    loading: state.loading,
    error: state.error,
    refresh,
    search,
    reset,
  };
}
