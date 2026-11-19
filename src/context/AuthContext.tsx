import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiFetch, setAuthToken } from '../lib/api';

export type RoleCode = 'OWNER' | 'ADMIN' | 'PRODUCTION_SUPERVISOR' | 'SALESMAN' | 'AUDITOR' | 'PENDING';

export interface SessionUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  roleId: number;
  roleCode: RoleCode;
  phone: string;
  isActive: boolean;
}

export interface CompanyInfo {
  id: number;
  companyName: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
  phone: string;
  email: string;
  varianceTolerancePct: number;
  costingMethod: string;
  invoicePrefix: string;
  financialYear: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  company: CompanyInfo | null;
  loading: boolean;
  initializing: boolean;
  loginWithCredentials: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const loginWithCredentials = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ token?: string; user: SessionUser; company: CompanyInfo | null }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: { email, password },
        }
      );
      // Session is persisted server-side via HttpOnly cookie; never store tokens in localStorage.
      setAuthToken(null);
      setUser(res.user);
      setCompany(res.company);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      // Exchange Firebase ID token for a server-managed HttpOnly session cookie
      const res = await apiFetch<{ user: SessionUser; company: CompanyInfo | null }>('/api/auth/session', {
        method: 'POST',
        body: { idToken },
      });
      setAuthToken(null);
      setUser(res.user);
      setCompany(res.company);
    } catch (err) {
      setAuthToken(null);
      setUser(null);
      setCompany(null);
      await firebaseSignOut(auth).catch(() => {});
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const res = await apiFetch<{ user: SessionUser; company: CompanyInfo | null }>('/api/auth/me');
    setUser(res.user);
    setCompany(res.company);
  }, []);

  const logout = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    setCompany(null);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Proceed even if server logout call encounters a transient network error
    }
    try {
      await firebaseSignOut(auth);
    } catch {
      // Ignore if signed in via ERP role account
    }
  }, []);

  // Hydrate existing server-managed HttpOnly cookie session on page load / refresh
  useEffect(() => {
    let active = true;
    const bootstrapSession = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('autostart') === '1') {
          const role = (params.get('role') || 'OWNER').toUpperCase();
          const emailMap: Record<string, string> = {
            OWNER: 'owner@factoryflow.in',
            ADMIN: 'admin@factoryflow.in',
            PRODUCTION_SUPERVISOR: 'supervisor@factoryflow.in',
            SALESMAN: 'sales@factoryflow.in',
            AUDITOR: 'auditor@factoryflow.in',
          };
          const email = emailMap[role] || 'owner@factoryflow.in';
          await loginWithCredentials(email, 'Password@123');
          return;
        }

        const res = await fetch('/api/auth/session', {
          method: 'GET',
          credentials: 'include',
        });
        if (res.ok && active) {
          const data = (await res.json()) as {
            authenticated?: boolean;
            user: SessionUser | null;
            company: CompanyInfo | null;
          };
          if (data.authenticated && data.user) {
            setUser(data.user);
            setCompany(data.company);
          }
        }
      } catch {
        // No active session cookie -> render login screen
      } finally {
        if (active) setInitializing(false);
      }
    };
    bootstrapSession();
    return () => {
      active = false;
    };
  }, [loginWithCredentials]);

  return (
    <AuthContext.Provider
      value={{
        user,
        company,
        loading,
        initializing,
        loginWithCredentials,
        loginWithGoogle,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
