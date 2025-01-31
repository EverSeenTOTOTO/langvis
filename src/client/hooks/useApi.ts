import { useCallback, useState } from 'react';

export default <P, R>(api: (req: P) => Promise<R>) => {
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (req: P) => {
      setLoading(true);
      try {
        return await api(req);
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
