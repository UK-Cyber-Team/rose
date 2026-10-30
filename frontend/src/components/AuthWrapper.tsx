import React, { useEffect } from 'react';
import { useCheckAuthStatusQuery } from '../api';
import { useAppDispatch, useAppSelector } from '../store';
import { setAuthStatus, setLoading } from '../store/auth';
import { Login } from './Login';

interface AuthWrapperProps {
  children: React.ReactNode;
}

export const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const dispatch = useAppDispatch();
  const { isAuthenticated, authRequired, isLoading } = useAppSelector((state) => state.auth);
  
  const { data: authStatus, error, isLoading: authStatusLoading } = useCheckAuthStatusQuery();

  useEffect(() => {
    if (authStatus) {
      dispatch(setAuthStatus({
        authenticated: authStatus.authenticated,
        auth_required: authStatus.auth_required
      }));
    }
  }, [authStatus, dispatch]);

  useEffect(() => {
    if (!authStatusLoading) {
      dispatch(setLoading(false));
    }
  }, [authStatusLoading, dispatch]);

  // Show loading spinner while checking authentication
  if (isLoading || authStatusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // If authentication is required but user is not authenticated, show login
  if (authRequired && !isAuthenticated) {
    return <Login />;
  }

  // If authentication is not required or user is authenticated, show app
  return <>{children}</>;
};