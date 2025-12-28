import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export const useSearchParam = (
  key: string,
): [string | null, (value: string | null) => void] => {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = useMemo(() => searchParams.get(key), [searchParams, key]);

  const setValue = useCallback(
    (newValue: string | null) => {
      setSearchParams(
        prev => {
          const params = new URLSearchParams(prev);
          if (newValue === null) {
            params.delete(key);
          } else {
            params.set(key, newValue);
          }
          return params;
        },
        { replace: true },
      );
    },
    [key, setSearchParams],
  );

  return [value, setValue];
};
