import { useCallback, useState } from 'react';

export default <P, R>(api: (...args: P[]) => Promise<R>) => {
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (...args: P[]) => {
      setLoading(true);
      try {
        return await api(...args);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  return {
    loading,
    run,
  };
};
