import { useStore } from '@/client/store';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  skipAuth?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  skipAuth = false,
}) => {
  const userStore = useStore('user');
  const location = useLocation();

  // If skipAuth is true (e.g., for login page), render children directly
  if (skipAuth) {
    return <>{children}</>;
  }

  // If user is authenticated, render children
  if (userStore.currentUser) {
    return <>{children}</>;
  }

  // If user is not authenticated and we're in browser, redirect to login
  return <Navigate to="/login" state={{ from: location.pathname }} replace />;
};

export default observer(ProtectedRoute);

