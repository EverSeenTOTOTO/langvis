import React from 'react';
import { useStore } from '@/client/store';
import { useLocation, Navigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';

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

  // If user is not authenticated, redirect to login
  return <Navigate to="/login" state={{ from: location.pathname }} replace />;
};

export default observer(ProtectedRoute);

