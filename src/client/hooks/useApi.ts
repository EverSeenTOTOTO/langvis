import { useCallback, useState } from 'react';

export default <P, R extends Promise<unknown>>(api: (...args: P[]) => R) => {
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    (...args: P[]) => {
      setLoading(true);
      return api(...args).finally(() => setLoading(false));
    },
    [api],
  );

  return {
    loading,
    run,
  };
};
