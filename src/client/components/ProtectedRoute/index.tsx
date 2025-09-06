import { useStore } from '@/client/store';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Header from '../Header';
import './index.scss';

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
  const header = withHeader ? <Header /> : null;

  // If skipAuth is true (e.g., for login page), render children directly
  if (skipAuth) {
    return (
      <>
        {header}
        {children}
      </>
    );
  }

  // If user is authenticated, render children
  if (userStore.currentUser) {
    return (
      <>
        {header}
        {children}
      </>
    );
  }

  // If user is not authenticated and we're in browser, redirect to login
  return <Navigate to="/login" state={{ from: location.pathname }} replace />;
};

export default observer(ProtectedRoute);
