import { useCallback, useEffect, useRef } from 'react';

/**
 * 保持函数引用稳定，始终调用最新版本
 * 用于避免 useCallback 因依赖变化导致引用不稳定的问题
 */
export function useMemorizedFn<T extends (...args: any[]) => any>(fn: T): T {
  const fnRef = useRef<T>(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  return useCallback(
    (...args: Parameters<T>) => fnRef.current(...args),
    [],
  ) as T;
}
