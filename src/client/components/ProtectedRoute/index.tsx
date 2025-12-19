import { useStore } from '@/client/store';
import { observer } from 'mobx-react-lite';
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Header from '../Header';

interface ProtectedRouteProps {
  children: React.ReactNode;
  skipAuth?: boolean;
  withHeader?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  skipAuth = false,
  withHeader = true,
}) => {
  const userStore = useStore('user');
  const location = useLocation();
  const navigate = useNavigate();
  const header = withHeader ? <Header /> : null;

  useEffect(() => {
    if (!skipAuth && !userStore.currentUser) {
      // If user is not authenticated and we're in browser, redirect to login
      navigate('/login', {
        state: {
          from: location.pathname,
        },
        replace: true,
      });
    }
  }, [skipAuth, userStore.currentUser]);

  return (
    <>
      {header}
      {children}
    </>
  );
};

export default observer(ProtectedRoute);
