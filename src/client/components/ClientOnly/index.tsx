import React, { useEffect, useState } from 'react';

const ClientOnly: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback = null }) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  return isMounted ? <>{children}</> : <>{fallback}</>;
};

export default ClientOnly;
